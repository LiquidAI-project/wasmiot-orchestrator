//! This crate contains functions that for testing purposes demonstrate variety of things possible
//! in Wasm-IoT WebAssembly functions without the use of non-WASI host imports.
//!
//! Expected mounts are:
//! - deployFile
//! - execFile
//! - outFile

use std::collections::hash_map::DefaultHasher;
use std::hash::Hasher;
use std::fs;


const DEPLOY_FILE_NAME: &str = "deployFile";
const EXECUTE_FILE_NAME: &str = "execFile";
pub const OUTPUT_FILE_NAME: &str = "outFile";

#[derive(Debug)]
enum MountReadFailed {
    Deploy = -1337,
    Exec = -2337,
    Out = 404,
}

fn handle_error(error: std::io::Error, eenum: MountReadFailed) -> i32 {
    eprintln!("Error: Reading a mount-file ({:?}) failed: {:?}", eenum, error);

    eenum as i32
}

/// Demonstrates reading from files and returning signed 32bit integer.
#[no_mangle]
pub fn a(p0: u32, p1: f32) -> i32 {
    let dbytes = match fs::read(DEPLOY_FILE_NAME)  { Ok(x) => x, Err(e) => return handle_error(e, MountReadFailed::Deploy) };
    let ebytes = match fs::read(EXECUTE_FILE_NAME) { Ok(x) => x, Err(e) => return handle_error(e, MountReadFailed::Exec) };
    // Do something with the files to indicate they are really read.
    let mut hasher = DefaultHasher::new();
    hasher.write(&dbytes);
    hasher.write(&ebytes);

    let result = p0 as i32 + p1 as i32 + hasher.finish() as i32;

    // Always return a negative value.
    if result <= 0 { result.saturating_sub(1) } else { -result }
}

/// Demonstrates returning a 32bit floating point value.
#[no_mangle]
pub fn b() -> f32 {
    4.2
}

/// Demonstrates writing to a file and returning unsigned 32bit integer.
#[no_mangle]
pub fn c() -> u32 {
    // Write something into the file to indicate it is really manipulated.
    match fs::write(OUTPUT_FILE_NAME, b"42") { Ok(_) => {}, Err(e) => return handle_error(e, MountReadFailed::Out) as u32 };

    // The Wasm-integer is a _signed_ 32bit so cut the unsigned short.
    i32::MAX as u32
}
