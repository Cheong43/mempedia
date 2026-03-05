use std::env;
use std::fs;
use std::io::{self, Read};

use agent_memory::api::MemoryEngine;

fn main() {
    if let Err(err) = run() {
        eprintln!("error: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut data_dir = String::from("./data");
    let mut action_json: Option<String> = None;

    let args: Vec<String> = env::args().collect();
    let mut i = 1usize;
    while i < args.len() {
        match args[i].as_str() {
            "--help" | "-h" => {
                print_help();
                return Ok(());
            }
            "--data" => {
                i += 1;
                let value = args.get(i).ok_or("missing value for --data")?;
                data_dir = value.clone();
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
            other => return Err(format!("unknown argument: {other}").into()),
        }
        i += 1;
    }

    let payload =
        action_json.ok_or("missing action payload, use --action/--action-file/--stdin")?;
    let mut engine = MemoryEngine::open(data_dir)?;
    let result = engine.execute_action_json(&payload);
    println!("{result}");
    Ok(())
}

fn print_help() {
    println!(
        "Usage:
  agent_memory --action '<json>' [--data ./data]
  agent_memory --action-file action.json [--data ./data]
  cat action.json | agent_memory --stdin [--data ./data]"
    );
}
