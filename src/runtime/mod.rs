use std::io::{self, BufRead, Write};
use std::path::Path;

use crate::api::MemoryEngine;
use crate::core::MemoryResult;

pub fn serve_ndjson<P: AsRef<Path>>(data_dir: P) -> MemoryResult<()> {
    let mut engine = MemoryEngine::open(data_dir)?;
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(err) => {
                writeln!(
                    stdout,
                    "{{\"kind\":\"error\",\"message\":\"stdin read error: {err}\"}}"
                )?;
                stdout.flush()?;
                continue;
            }
        };

        let payload = line.trim();
        if payload.is_empty() {
            continue;
        }
        if payload == ":quit" || payload == ":exit" {
            break;
        }

        let out = engine.execute_action_json(payload);
        writeln!(stdout, "{out}")?;
        stdout.flush()?;
    }

    Ok(())
}
