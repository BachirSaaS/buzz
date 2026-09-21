//! One warmed recognizer on its owning thread; bounded work, no retained user audio.
use crate::huddle::models;
use std::sync::{mpsc, Mutex};
use tokio::sync::oneshot;

type Reply = oneshot::Sender<Result<String, String>>;
struct Job {
    samples: Vec<f32>,
    reply: Reply,
}
static WORKER: Mutex<Option<mpsc::SyncSender<Job>>> = Mutex::new(None);

fn create_recognizer() -> Result<sherpa_onnx::OfflineRecognizer, String> {
    let dir = models::stt_model_dir().ok_or("Speech model is still downloading.")?;
    let mut cfg = sherpa_onnx::OfflineRecognizerConfig::default();
    cfg.model_config.nemo_ctc.model =
        Some(dir.join("model.int8.onnx").to_string_lossy().into_owned());
    cfg.model_config.tokens = Some(dir.join("tokens.txt").to_string_lossy().into_owned());
    cfg.model_config.num_threads = 2;
    cfg.model_config.debug = false;
    sherpa_onnx::OfflineRecognizer::create(&cfg).ok_or("Couldn't load the speech model.".into())
}

/// Empty samples warm the model; nonempty samples use a fresh stream on the same recognizer.
pub(super) async fn recognize(samples: Vec<f32>) -> Result<String, String> {
    let (reply, response) = oneshot::channel();
    {
        let mut worker = WORKER.lock().map_err(|_| "Speech worker lock failed.")?;
        if worker.is_none() {
            let (sender, receiver) = mpsc::sync_channel::<Job>(1);
            std::thread::Builder::new()
                .name("interface-speech".into())
                .spawn(move || {
                    let mut recognizer = None;
                    while let Ok(job) = receiver.recv() {
                        if job.reply.is_closed() {
                            continue;
                        }
                        let result = (|| {
                            if recognizer.is_none() {
                                recognizer = Some(create_recognizer()?);
                            }
                            let model = recognizer.as_ref().ok_or("Speech model unavailable.")?;
                            if job.samples.is_empty() {
                                return Ok(String::new());
                            }
                            let stream = model.create_stream();
                            stream.accept_waveform(16_000, &job.samples);
                            model.decode(&stream);
                            let text = stream
                                .get_result()
                                .map(|r| r.text.trim().to_string())
                                .unwrap_or_default();
                            if text.len() > 4_000 {
                                return Err("Speech transcript exceeded its limit.".into());
                            }
                            Ok(text)
                        })();
                        // A cancelled listener owns no result; its audio is dropped with this job.
                        let _ = job.reply.send(result);
                    }
                })
                .map_err(|error| format!("Couldn't start speech recognition: {error}"))?;
            *worker = Some(sender);
        }
        let sender = worker.as_ref().ok_or("Speech worker unavailable.")?;
        match sender.try_send(Job { samples, reply }) {
            Ok(()) => {}
            Err(mpsc::TrySendError::Full(_)) => return Err("Speech recognition is busy.".into()),
            Err(mpsc::TrySendError::Disconnected(_)) => {
                *worker = None;
                return Err("Speech recognition stopped. Start listening again.".into());
            }
        }
    }
    response
        .await
        .map_err(|_| "Speech recognition was interrupted.".to_string())?
}
