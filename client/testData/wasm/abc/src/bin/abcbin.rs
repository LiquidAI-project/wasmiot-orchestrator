fn main() {
    println!("a(): {}", abc::a(1, 2.5));
    println!("b(): {}", abc::b());
    let coutval = abc::c();
    let coutfile = {
        let mut s = String::new();
        std::io::Read::read_to_string(
            &mut std::fs::File::open(abc::OUTPUT_FILE_NAME).unwrap(),
            &mut s
        ).unwrap();
        s
    };
    println!(
        "c(): {}, file '{}' contains: '{}'",
        coutval, abc::OUTPUT_FILE_NAME, coutfile,
    );
}
