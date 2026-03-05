use std::env;
use std::fs;
use std::io::{self, Read};
use std::path::PathBuf;

use agent_memory::api::MemoryEngine;
use agent_memory::runtime;

fn main() {
    if let Err(err) = run() {
        eprintln!("error: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut data_dir_override: Option<PathBuf> = None;
    let mut project_dir: Option<PathBuf> = None;
    let mut action_json: Option<String> = None;
    let mut serve_mode = false;

    let args: Vec<String> = env::args().collect();
    let mut i = 1usize;
    while i < args.len() {
        match args[i].as_str() {
            "--help" | "-h" => {
                print_help();
                return Ok(());
            }
            "--project" => {
                i += 1;
                let value = args.get(i).ok_or("missing value for --project")?;
                project_dir = Some(PathBuf::from(value));
            }
            "--data" => {
                i += 1;
                let value = args.get(i).ok_or("missing value for --data")?;
                data_dir_override = Some(PathBuf::from(value));
            }
            "--action" => {
                i += 1;
                let value = args.get(i).ok_or("missing value for --action")?;
                action_json = Some(value.clone());
            }
            "--action-file" => {
                i += 1;
                let value = args.get(i).ok_or("missing value for --action-file")?;
                action_json = Some(fs::read_to_string(value)?);
            }
            "--stdin" => {
                let mut buf = String::new();
                io::stdin().read_to_string(&mut buf)?;
                action_json = Some(buf);
            }
            "--serve" => {
                serve_mode = true;
            }
            "--print-data-dir" => {
                let data_dir = resolve_data_dir(project_dir.clone(), data_dir_override.clone())?;
                println!("{}", data_dir.display());
                return Ok(());
            }
            other => return Err(format!("unknown argument: {other}").into()),
        }
        i += 1;
    }

    let data_dir = resolve_data_dir(project_dir, data_dir_override)?;
    fs::create_dir_all(&data_dir)?;

    if serve_mode {
        runtime::serve_ndjson(data_dir)?;
        return Ok(());
    }

    let payload = action_json
        .ok_or("missing action payload, use --action/--action-file/--stdin or run with --serve")?;
    let mut engine = MemoryEngine::open(data_dir)?;
    let result = engine.execute_action_json(payload.trim());
    println!("{result}");
    Ok(())
}

fn resolve_data_dir(
    project_dir: Option<PathBuf>,
    data_dir_override: Option<PathBuf>,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Some(path) = data_dir_override {
        return Ok(path);
    }

    let project = match project_dir {
        Some(path) => path,
        None => env::current_dir()?,
    };
    Ok(project.join(".M2W").join("memory"))
}

fn print_help() {
    println!(
        "Usage:
  agent_memory --action '<json>' [--project /path/to/project]
  agent_memory --action-file action.json [--project /path/to/project]
  cat action.json | agent_memory --stdin [--project /path/to/project]
  agent_memory --serve [--project /path/to/project]

Options:
  --project <dir>      Project root; data stored in <dir>/.M2W/memory
  --data <dir>         Explicit data directory (overrides --project)
  --serve              Start runtime process (NDJSON over stdin/stdout)
  --print-data-dir     Print resolved storage path and exit"
    );
}
