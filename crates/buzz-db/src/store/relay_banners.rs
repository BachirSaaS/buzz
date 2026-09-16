//! Deployment-global relay banner persistence and per-user state.
//!
//! A deployment has at most one active banner.  Delivery is community-scoped at
//! read time: an active banner either targets every community, including future
//! communities, or an explicit non-empty set of community ids.

use buzz_core::CommunityId;
use buzz_datastore_tracing::datastore_span;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, Row as _, Transaction};
use uuid::Uuid;

use crate::{Db, Result};

/// Maximum relay banner message length in Unicode scalar count.
pub const MAX_BANNER_MESSAGE_CHARS: usize = 2_000;

/// Relay banner severity values accepted by the backend and emitted to clients.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RelayBannerSeverity {
    /// Informational banner.
    Info,
    /// Warning banner.
    Warning,
    /// Urgent banner.
    Urgent,
}

impl RelayBannerSeverity {
    /// Returns the wire/database representation.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Warning => "warning",
            Self::Urgent => "urgent",
        }
    }

    fn parse(value: String) -> Result<Self> {
        match value.as_str() {
            "info" => Ok(Self::Info),
            "warning" => Ok(Self::Warning),
            "urgent" => Ok(Self::Urgent),
            other => Err(crate::DbError::InvalidData(format!(
                "invalid relay banner severity: {other}"
            ))),
        }
    }
}

/// Public targeting scope value used by the admin/client banner contracts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RelayBannerTargetScope {
    /// Banner targets every community.
    All,
    /// Banner targets selected communities only.
    Communities,
}

impl RelayBannerTargetScope {
    /// Returns the wire representation.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Communities => "communities",
        }
    }
}

/// Targeting scope for an operator-configured relay banner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelayBannerScope {
    /// Banner applies to every community, including communities created later.
    AllCommunities,
    /// Banner applies only to this non-empty community set.
    Communities(Vec<CommunityId>),
}

/// Input for replacing the deployment's active banner.
#[derive(Debug, Clone)]
pub struct RelayBannerUpsert {
    /// Severity/type of the banner.
    pub severity: RelayBannerSeverity,
    /// Plain-text message, 1..=2000 characters.
    pub message: String,
    /// Number of successful views each user may receive before suppression.
    pub max_displays: i32,
    /// Targeting scope.
    pub scope: RelayBannerScope,
    /// Authenticated operator pubkey performing the write.
    pub actor_pubkey: Vec<u8>,
}

/// Stored relay banner plus targeting metadata.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelayBannerRecord {
    /// Monotonic internal banner id.
    pub id: i64,
    /// Stable public banner id exposed on the wire.
    pub public_id: Uuid,
    /// Severity/type of the banner.
    pub severity: RelayBannerSeverity,
    /// Plain-text message.
    pub message: String,
    /// Number of successful views each user may receive before suppression.
    pub max_displays: i32,
    /// Whether the banner targets every community.
    pub target_all_communities: bool,
    /// Explicit community targets when not targeting all communities.
    pub community_ids: Vec<CommunityId>,
    /// Row creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Row update timestamp.
    pub updated_at: DateTime<Utc>,
    /// Operator pubkey that created the row.
    pub created_by: Vec<u8>,
    /// Disable timestamp, if disabled.
    pub disabled_at: Option<DateTime<Utc>>,
}

impl RelayBannerRecord {
    /// Returns the public target-scope enum for this banner.
    pub const fn target_scope(&self) -> RelayBannerTargetScope {
        if self.target_all_communities {
            RelayBannerTargetScope::All
        } else {
            RelayBannerTargetScope::Communities
        }
    }
}

/// Result of recording a banner view acknowledgement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelayBannerViewOutcome {
    /// The display was accepted and consumed one remaining view.
    Accepted {
        /// Display count after accepting this view.
        display_count: i32,
    },
    /// The banner was already permanently dismissed by this user.
    Dismissed,
    /// The user had already exhausted `max_displays`.
    Exhausted {
        /// Display count already consumed by this user.
        display_count: i32,
    },
    /// The banner is not active or does not target the request community.
    NotEligible,
}

/// Result of recording a banner dismiss acknowledgement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelayBannerDismissOutcome {
    /// Dismiss state was present after the call. True means this call wrote it.
    Dismissed {
        /// Whether this call changed durable state from not-dismissed to dismissed.
        changed: bool,
    },
    /// The banner is not active or does not target the request community.
    NotEligible,
}

impl RelayBannerUpsert {
    fn validate(&self) -> Result<()> {
        let trimmed_empty = self.message.trim().is_empty();
        let char_count = self.message.chars().count();
        if trimmed_empty || char_count > MAX_BANNER_MESSAGE_CHARS {
            return Err(crate::DbError::InvalidData(format!(
                "relay banner message must be 1..={MAX_BANNER_MESSAGE_CHARS} characters"
            )));
        }
        if self.max_displays < 1 {
            return Err(crate::DbError::InvalidData(
                "relay banner max_displays must be >= 1".to_owned(),
            ));
        }
        if self.actor_pubkey.len() != 32 {
            return Err(crate::DbError::InvalidData(
                "relay banner actor pubkey must be 32 bytes".to_owned(),
            ));
        }
        if let RelayBannerScope::Communities(ids) = &self.scope {
            if ids.is_empty() {
                return Err(crate::DbError::InvalidData(
                    "relay banner community scope must be non-empty".to_owned(),
                ));
            }
        }
        Ok(())
    }
}

async fn acquire_banner_lock(tx: &mut Transaction<'_, Postgres>) -> Result<()> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('relay_banner_active', 0))")
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn banner_internal_id_for_public_id(
    tx: &mut Transaction<'_, Postgres>,
    public_id: Uuid,
) -> Result<Option<i64>> {
    sqlx::query_scalar::<_, i64>(
        r#"
        SELECT id
        FROM relay_banners
        WHERE public_id = $1
          AND disabled_at IS NULL
        "#,
    )
    .bind(public_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(Into::into)
}

async fn banner_targets_community(
    tx: &mut Transaction<'_, Postgres>,
    banner_id: i64,
    community_id: CommunityId,
) -> Result<bool> {
    let eligible = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM relay_banners b
            WHERE b.id = $1
              AND b.disabled_at IS NULL
              AND (
                    b.target_all_communities
                 OR EXISTS (
                        SELECT 1
                        FROM relay_banner_communities bc
                        WHERE bc.banner_id = b.id
                          AND bc.community_id = $2
                    )
              )
        )
        "#,
    )
    .bind(banner_id)
    .bind(community_id.as_uuid())
    .fetch_one(&mut **tx)
    .await?;
    Ok(eligible)
}

impl Db {
    /// Lists active communities for the admin banner community picker.
    #[datastore_span(name = "admin_list_banner_communities", system = "postgresql")]
    pub async fn admin_list_banner_communities(&self) -> Result<Vec<crate::CommunityRecord>> {
        let mut connection = crate::observability::acquire_writer(
            &self.pool,
            crate::observability::WriterOperation::Authorization,
        )
        .await?;
        let rows = sqlx::query(
            r#"
            SELECT id, host
            FROM communities
            WHERE archived_at IS NULL
              AND deleted_at IS NULL
              AND deletion_state = 'active'
            ORDER BY lower(host), id
            "#,
        )
        .fetch_all(&mut *connection)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(crate::CommunityRecord {
                    id: CommunityId::from_uuid(row.try_get("id")?),
                    host: row.try_get("host")?,
                })
            })
            .collect()
    }

    /// Lists relay banners, newest first, retaining disabled history.
    #[datastore_span(name = "admin_list_relay_banners", system = "postgresql")]
    pub async fn admin_list_relay_banners(&self, limit: i64) -> Result<Vec<RelayBannerRecord>> {
        let limit = limit.clamp(1, 200);
        let mut connection = crate::observability::acquire_writer(
            &self.pool,
            crate::observability::WriterOperation::Authorization,
        )
        .await?;
        let rows = sqlx::query(
            r#"
            SELECT
                b.id,
                b.public_id,
                b.severity,
                b.message,
                b.max_displays,
                b.target_all_communities,
                b.created_by,
                b.created_at,
                b.updated_at,
                b.disabled_at,
                COALESCE(array_agg(bc.community_id ORDER BY bc.community_id)
                    FILTER (WHERE bc.community_id IS NOT NULL), ARRAY[]::uuid[]) AS community_ids
            FROM relay_banners b
            LEFT JOIN relay_banner_communities bc ON bc.banner_id = b.id
            GROUP BY b.id
            ORDER BY b.updated_at DESC, b.id DESC
            LIMIT $1
            "#,
        )
        .bind(limit)
        .fetch_all(&mut *connection)
        .await?;
        rows.into_iter().map(row_to_banner).collect()
    }

    /// Returns the currently active deployment banner, if any.
    #[datastore_span(name = "admin_get_active_relay_banner", system = "postgresql")]
    pub async fn admin_get_active_relay_banner(&self) -> Result<Option<RelayBannerRecord>> {
        let mut items = self.admin_list_active_relay_banners(1).await?;
        Ok(items.pop())
    }

    async fn admin_list_active_relay_banners(&self, limit: i64) -> Result<Vec<RelayBannerRecord>> {
        let mut connection = crate::observability::acquire_writer(
            &self.pool,
            crate::observability::WriterOperation::Authorization,
        )
        .await?;
        let rows = sqlx::query(
            r#"
            SELECT
                b.id,
                b.public_id,
                b.severity,
                b.message,
                b.max_displays,
                b.target_all_communities,
                b.created_by,
                b.created_at,
                b.updated_at,
                b.disabled_at,
                COALESCE(array_agg(bc.community_id ORDER BY bc.community_id)
                    FILTER (WHERE bc.community_id IS NOT NULL), ARRAY[]::uuid[]) AS community_ids
            FROM relay_banners b
            LEFT JOIN relay_banner_communities bc ON bc.banner_id = b.id
            WHERE b.disabled_at IS NULL
            GROUP BY b.id
            ORDER BY b.id DESC
            LIMIT $1
            "#,
        )
        .bind(limit)
        .fetch_all(&mut *connection)
        .await?;
        rows.into_iter().map(row_to_banner).collect()
    }

    /// Replaces the single active deployment banner and returns the new row.
    #[datastore_span(name = "admin_upsert_relay_banner", system = "postgresql")]
    pub async fn admin_upsert_relay_banner(
        &self,
        input: RelayBannerUpsert,
    ) -> Result<RelayBannerRecord> {
        input.validate()?;
        let connection = crate::observability::acquire_writer(
            &self.pool,
            crate::observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = sqlx::Transaction::begin(connection, None).await?;
        acquire_banner_lock(&mut tx).await?;

        sqlx::query(
            r#"
            UPDATE relay_banners
            SET disabled_at = now(), disabled_by = $1, updated_at = now(), updated_by = $1
            WHERE disabled_at IS NULL
            "#,
        )
        .bind(&input.actor_pubkey)
        .execute(&mut *tx)
        .await?;

        let target_all = matches!(input.scope, RelayBannerScope::AllCommunities);
        let row = sqlx::query(
            r#"
            INSERT INTO relay_banners
                (severity, message, max_displays, target_all_communities, created_by, updated_by)
            VALUES ($1, $2, $3, $4, $5, $5)
            RETURNING id, public_id, severity, message, max_displays, target_all_communities,
                      created_by, created_at, updated_at, disabled_at
            "#,
        )
        .bind(input.severity.as_str())
        .bind(&input.message)
        .bind(input.max_displays)
        .bind(target_all)
        .bind(&input.actor_pubkey)
        .fetch_one(&mut *tx)
        .await?;
        let banner_id: i64 = row.try_get("id")?;

        let community_ids = match input.scope {
            RelayBannerScope::AllCommunities => Vec::new(),
            RelayBannerScope::Communities(ids) => {
                for community_id in &ids {
                    sqlx::query(
                        "INSERT INTO relay_banner_communities (banner_id, community_id) VALUES ($1, $2)",
                    )
                    .bind(banner_id)
                    .bind(community_id.as_uuid())
                    .execute(&mut *tx)
                    .await?;
                }
                ids
            }
        };

        tx.commit().await?;
        Ok(RelayBannerRecord {
            id: banner_id,
            public_id: row.try_get("public_id")?,
            severity: RelayBannerSeverity::parse(row.try_get("severity")?)?,
            message: row.try_get("message")?,
            max_displays: row.try_get("max_displays")?,
            target_all_communities: row.try_get("target_all_communities")?,
            community_ids,
            created_by: row.try_get("created_by")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
            disabled_at: row.try_get("disabled_at")?,
        })
    }

    /// Disables the currently active deployment banner, preserving history and state.
    #[datastore_span(name = "admin_disable_active_relay_banner", system = "postgresql")]
    pub async fn admin_disable_active_relay_banner(&self, actor_pubkey: &[u8]) -> Result<bool> {
        let connection = crate::observability::acquire_writer(
            &self.pool,
            crate::observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = sqlx::Transaction::begin(connection, None).await?;
        acquire_banner_lock(&mut tx).await?;
        let result = sqlx::query(
            r#"
            UPDATE relay_banners
            SET disabled_at = now(), disabled_by = $1, updated_at = now(), updated_by = $1
            WHERE disabled_at IS NULL
            "#,
        )
        .bind(actor_pubkey)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(result.rows_affected() > 0)
    }

    /// Resolves the active banner eligible for this user in this community.
    #[datastore_span(name = "active_relay_banner_for_user", system = "postgresql")]
    pub async fn active_relay_banner_for_user(
        &self,
        community_id: CommunityId,
        pubkey: &[u8],
    ) -> Result<Option<RelayBannerRecord>> {
        let mut connection = crate::observability::acquire_writer(
            &self.pool,
            crate::observability::WriterOperation::Authorization,
        )
        .await?;
        let row = sqlx::query(
            r#"
            SELECT
                b.id,
                b.public_id,
                b.severity,
                b.message,
                b.max_displays,
                b.target_all_communities,
                b.created_by,
                b.created_at,
                b.updated_at,
                b.disabled_at,
                COALESCE(array_agg(bc_all.community_id ORDER BY bc_all.community_id)
                    FILTER (WHERE bc_all.community_id IS NOT NULL), ARRAY[]::uuid[]) AS community_ids
            FROM relay_banners b
            LEFT JOIN relay_banner_communities bc_all ON bc_all.banner_id = b.id
            LEFT JOIN relay_banner_user_state us
              ON us.banner_id = b.id
             AND us.community_id = $1
             AND us.pubkey = $2
            WHERE b.disabled_at IS NULL
              AND (b.target_all_communities OR EXISTS (
                    SELECT 1
                    FROM relay_banner_communities bc
                    WHERE bc.banner_id = b.id
                      AND bc.community_id = $1
              ))
              AND us.dismissed_at IS NULL
              AND COALESCE(us.display_count, 0) < b.max_displays
            GROUP BY b.id, us.display_count, us.dismissed_at
            ORDER BY b.id DESC
            LIMIT 1
            "#,
        )
        .bind(community_id.as_uuid())
        .bind(pubkey)
        .fetch_optional(&mut *connection)
        .await?;
        row.map(row_to_banner).transpose()
    }

    /// Records a successful client render/view acknowledgement.
    #[datastore_span(name = "ack_relay_banner_view", system = "postgresql")]
    pub async fn ack_relay_banner_view(
        &self,
        community_id: CommunityId,
        public_id: Uuid,
        pubkey: &[u8],
    ) -> Result<RelayBannerViewOutcome> {
        let connection = crate::observability::acquire_writer(
            &self.pool,
            crate::observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = sqlx::Transaction::begin(connection, None).await?;
        let Some(banner_id) = banner_internal_id_for_public_id(&mut tx, public_id).await? else {
            tx.rollback().await?;
            return Ok(RelayBannerViewOutcome::NotEligible);
        };
        if !banner_targets_community(&mut tx, banner_id, community_id).await? {
            tx.rollback().await?;
            return Ok(RelayBannerViewOutcome::NotEligible);
        }

        let row = sqlx::query(
            r#"
            INSERT INTO relay_banner_user_state
                (banner_id, community_id, pubkey, display_count, first_viewed_at, last_viewed_at)
            SELECT b.id, $2, $3, 1, now(), now()
            FROM relay_banners b
            WHERE b.id = $1
              AND b.disabled_at IS NULL
              AND b.max_displays >= 1
            ON CONFLICT (banner_id, community_id, pubkey) DO UPDATE SET
                display_count = relay_banner_user_state.display_count + 1,
                first_viewed_at = COALESCE(relay_banner_user_state.first_viewed_at, now()),
                last_viewed_at = now(),
                updated_at = now()
            WHERE relay_banner_user_state.dismissed_at IS NULL
              AND relay_banner_user_state.display_count < (
                    SELECT max_displays FROM relay_banners WHERE id = $1 AND disabled_at IS NULL
              )
            RETURNING display_count
            "#,
        )
        .bind(banner_id)
        .bind(community_id.as_uuid())
        .bind(pubkey)
        .fetch_optional(&mut *tx)
        .await?;

        let outcome = if let Some(row) = row {
            RelayBannerViewOutcome::Accepted {
                display_count: row.try_get("display_count")?,
            }
        } else {
            let state = sqlx::query(
                r#"
                SELECT us.display_count, us.dismissed_at IS NOT NULL AS dismissed
                FROM relay_banner_user_state us
                WHERE us.banner_id = $1 AND us.community_id = $2 AND us.pubkey = $3
                "#,
            )
            .bind(banner_id)
            .bind(community_id.as_uuid())
            .bind(pubkey)
            .fetch_optional(&mut *tx)
            .await?;
            match state {
                Some(row) if row.try_get::<bool, _>("dismissed")? => {
                    RelayBannerViewOutcome::Dismissed
                }
                Some(row) => RelayBannerViewOutcome::Exhausted {
                    display_count: row.try_get("display_count")?,
                },
                None => RelayBannerViewOutcome::NotEligible,
            }
        };
        tx.commit().await?;
        Ok(outcome)
    }

    /// Permanently dismisses a banner for a user in one community.
    #[datastore_span(name = "ack_relay_banner_dismiss", system = "postgresql")]
    pub async fn ack_relay_banner_dismiss(
        &self,
        community_id: CommunityId,
        public_id: Uuid,
        pubkey: &[u8],
    ) -> Result<RelayBannerDismissOutcome> {
        let connection = crate::observability::acquire_writer(
            &self.pool,
            crate::observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = sqlx::Transaction::begin(connection, None).await?;
        let Some(banner_id) = banner_internal_id_for_public_id(&mut tx, public_id).await? else {
            tx.rollback().await?;
            return Ok(RelayBannerDismissOutcome::NotEligible);
        };
        if !banner_targets_community(&mut tx, banner_id, community_id).await? {
            tx.rollback().await?;
            return Ok(RelayBannerDismissOutcome::NotEligible);
        }

        let changed = sqlx::query_scalar::<_, bool>(
            r#"
            WITH inserted AS (
                INSERT INTO relay_banner_user_state
                    (banner_id, community_id, pubkey, dismissed_at)
                VALUES ($1, $2, $3, now())
                ON CONFLICT (banner_id, community_id, pubkey) DO NOTHING
                RETURNING TRUE AS changed
            ), updated AS (
                UPDATE relay_banner_user_state
                SET dismissed_at = now(), updated_at = now()
                WHERE banner_id = $1
                  AND community_id = $2
                  AND pubkey = $3
                  AND dismissed_at IS NULL
                  AND NOT EXISTS (SELECT 1 FROM inserted)
                RETURNING TRUE AS changed
            )
            SELECT COALESCE(
                (SELECT changed FROM inserted),
                (SELECT changed FROM updated),
                FALSE
            )
            "#,
        )
        .bind(banner_id)
        .bind(community_id.as_uuid())
        .bind(pubkey)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(RelayBannerDismissOutcome::Dismissed { changed })
    }
}

fn row_to_banner(row: sqlx::postgres::PgRow) -> Result<RelayBannerRecord> {
    let community_uuids: Vec<Uuid> = row.try_get("community_ids")?;
    Ok(RelayBannerRecord {
        id: row.try_get("id")?,
        public_id: row.try_get("public_id")?,
        severity: RelayBannerSeverity::parse(row.try_get("severity")?)?,
        message: row.try_get("message")?,
        max_displays: row.try_get("max_displays")?,
        target_all_communities: row.try_get("target_all_communities")?,
        community_ids: community_uuids
            .into_iter()
            .map(CommunityId::from_uuid)
            .collect(),
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        disabled_at: row.try_get("disabled_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;

    async fn setup_db() -> Db {
        let pool = PgPool::connect(&crate::test_support::database_url())
            .await
            .expect("connect to test DB");
        Db::from_pool(pool)
    }

    async fn make_community(pool: &PgPool) -> CommunityId {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(id)
            .bind(format!("banner-{}.example", id.simple()))
            .execute(pool)
            .await
            .expect("insert community");
        CommunityId::from_uuid(id)
    }

    fn actor(byte: u8) -> Vec<u8> {
        vec![byte; 32]
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn upsert_replaces_single_active_banner_and_retains_history() {
        let db = setup_db().await;
        let first = db
            .admin_upsert_relay_banner(RelayBannerUpsert {
                severity: RelayBannerSeverity::Info,
                message: "first".to_owned(),
                max_displays: 1,
                scope: RelayBannerScope::AllCommunities,
                actor_pubkey: actor(1),
            })
            .await
            .expect("insert first banner");
        let second = db
            .admin_upsert_relay_banner(RelayBannerUpsert {
                severity: RelayBannerSeverity::Warning,
                message: "second".to_owned(),
                max_displays: 2,
                scope: RelayBannerScope::AllCommunities,
                actor_pubkey: actor(2),
            })
            .await
            .expect("replace banner");

        let active = db
            .admin_get_active_relay_banner()
            .await
            .expect("get active")
            .expect("active banner");
        assert_eq!(active.id, second.id);
        let all = db.admin_list_relay_banners(10).await.expect("list banners");
        assert_eq!(all.len(), 2);
        assert!(all
            .iter()
            .any(|b| b.id == first.id && b.disabled_at.is_some()));
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn community_scope_filters_delivery() {
        let db = setup_db().await;
        let included = make_community(&db.pool).await;
        let excluded = make_community(&db.pool).await;
        let user = actor(3);
        let banner = db
            .admin_upsert_relay_banner(RelayBannerUpsert {
                severity: RelayBannerSeverity::Urgent,
                message: "scoped".to_owned(),
                max_displays: 1,
                scope: RelayBannerScope::Communities(vec![included]),
                actor_pubkey: actor(4),
            })
            .await
            .expect("insert scoped banner");

        assert_eq!(banner.community_ids, vec![included]);
        assert!(db
            .active_relay_banner_for_user(included, &user)
            .await
            .expect("included lookup")
            .is_some());
        assert!(db
            .active_relay_banner_for_user(excluded, &user)
            .await
            .expect("excluded lookup")
            .is_none());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn view_ack_consumes_display_and_then_exhausts() {
        let db = setup_db().await;
        let community = make_community(&db.pool).await;
        let user = actor(5);
        let banner = db
            .admin_upsert_relay_banner(RelayBannerUpsert {
                severity: RelayBannerSeverity::Info,
                message: "limited".to_owned(),
                max_displays: 1,
                scope: RelayBannerScope::AllCommunities,
                actor_pubkey: actor(6),
            })
            .await
            .expect("insert banner");

        assert_eq!(
            db.active_relay_banner_for_user(community, &user)
                .await
                .expect("lookup before view")
                .as_ref()
                .map(|active| active.id),
            Some(banner.id),
            "delivery lookup must not consume max_displays before client view ack"
        );
        assert_eq!(
            db.active_relay_banner_for_user(community, &user)
                .await
                .expect("second lookup before view")
                .as_ref()
                .map(|active| active.id),
            Some(banner.id),
            "repeated delivery lookups without view ack must not exhaust max_displays"
        );
        assert_eq!(
            db.ack_relay_banner_view(community, banner.public_id, &user)
                .await
                .expect("first view"),
            RelayBannerViewOutcome::Accepted { display_count: 1 }
        );
        assert_eq!(
            db.ack_relay_banner_view(community, banner.public_id, &user)
                .await
                .expect("second view"),
            RelayBannerViewOutcome::Exhausted { display_count: 1 }
        );
        assert!(db
            .active_relay_banner_for_user(community, &user)
            .await
            .expect("post-exhaust lookup")
            .is_none());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn dismiss_permanently_suppresses_banner() {
        let db = setup_db().await;
        let community = make_community(&db.pool).await;
        let user = actor(7);
        let banner = db
            .admin_upsert_relay_banner(RelayBannerUpsert {
                severity: RelayBannerSeverity::Info,
                message: "dismiss me".to_owned(),
                max_displays: 3,
                scope: RelayBannerScope::AllCommunities,
                actor_pubkey: actor(8),
            })
            .await
            .expect("insert banner");

        assert_eq!(
            db.ack_relay_banner_dismiss(community, banner.public_id, &user)
                .await
                .expect("dismiss"),
            RelayBannerDismissOutcome::Dismissed { changed: true }
        );
        assert_eq!(
            db.ack_relay_banner_dismiss(community, banner.public_id, &user)
                .await
                .expect("second dismiss"),
            RelayBannerDismissOutcome::Dismissed { changed: false }
        );
        assert_eq!(
            db.ack_relay_banner_view(community, banner.public_id, &user)
                .await
                .expect("view after dismiss"),
            RelayBannerViewOutcome::Dismissed
        );
        assert!(db
            .active_relay_banner_for_user(community, &user)
            .await
            .expect("lookup after dismiss")
            .is_none());
    }
}
