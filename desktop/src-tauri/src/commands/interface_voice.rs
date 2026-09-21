//! Local, explicitly activated live interface speech, separate from huddle posting.
use crate::{app_state::AppState, huddle::models};
use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::State;
#[path = "interface_speech_worker.rs"]
mod worker;
const MAX_SAMPLES: usize = 16_000 * 30;

/// Ensure the shared, integrity-checked speech model is being installed.
#[tauri::command]
pub async fn prepare_interface_voice(state: State<'_, AppState>) -> Result<bool, String> {
    let manager =
        models::global_model_manager().ok_or("Speech models are unavailable on this device.")?;
    if manager.is_stt_ready() {
        worker::recognize(Vec::new()).await?;
        return Ok(true);
    }
    manager.start_stt_download(state.http_client.clone());
    Ok(false)
}

fn samples(pcm: &str) -> Result<Vec<f32>, String> {
    if pcm.len() > MAX_SAMPLES * 4 * 4 / 3 + 4 {
        return Err("Speak for at most 30 seconds.".into());
    }
    let bytes = STANDARD.decode(pcm).map_err(|_| "Invalid command audio.")?;
    if bytes.is_empty() || bytes.len() > MAX_SAMPLES * 4 || !bytes.len().is_multiple_of(4) {
        return Err("Invalid command audio length.".into());
    }
    bytes
        .chunks_exact(4)
        .map(|b| {
            let value = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
            if value.is_finite() && (-1.0..=1.0).contains(&value) {
                Ok(value)
            } else {
                Err("Invalid audio sample.".into())
            }
        })
        .collect()
}

/// Transcribe up to thirty seconds of mono 16 kHz f32 PCM locally; never posts to a channel.
#[tauri::command]
pub async fn transcribe_interface_voice(
    pcm: String,
    partial: Option<bool>,
) -> Result<String, String> {
    let text = worker::recognize(samples(&pcm)?).await?;
    if text.is_empty() && !partial.unwrap_or(false) {
        return Err("No speech detected. Try again or type your command.".into());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Requires the installed speech model and a 16 kHz f32 command recording"]
    async fn transcribes_command_with_installed_model() {
        let bytes = std::fs::read(std::env::var("BUZZ_VOICE_PCM_PATH").unwrap()).unwrap();
        let result = transcribe_interface_voice(STANDARD.encode(bytes.clone()), Some(true))
            .await
            .unwrap();
        assert!(result.to_lowercase().contains("music"), "{result}");
        let warm = std::time::Instant::now();
        let repeated = transcribe_interface_voice(STANDARD.encode(bytes), Some(true))
            .await
            .unwrap();
        assert_eq!(result, repeated);
        eprintln!(
            "Warm local speech decoded in {:?}: {repeated}",
            warm.elapsed()
        );
    }
    #[test]
    fn audio_is_bounded_and_finite() {
        assert_eq!(
            samples(&STANDARD.encode(0.5_f32.to_le_bytes())).unwrap(),
            vec![0.5]
        );
        for bytes in [
            vec![],
            vec![0],
            f32::NAN.to_le_bytes().to_vec(),
            2_f32.to_le_bytes().to_vec(),
            vec![0; MAX_SAMPLES * 4 + 4],
        ] {
            assert!(samples(&STANDARD.encode(bytes)).is_err());
        }
    }
}
