//! Contains the main program that starts a ReSTful HTTP server for interacting with orchestrator.

use std::sync;

use actix_web::{
    get, http, middleware, web, App, HttpServer, HttpResponse
};

use wasmiot_orchestrator::{
    model,
    orchestrator::{WasmiotOrchestrator, OrchestratorApi},
};


mod api;


/// Handle non-existent paths.
async fn default_handler(req_method: http::Method) -> HttpResponse {
    match req_method {
        http::Method::GET => {
            HttpResponse::Accepted().finish()
        },

        _ => HttpResponse::MethodNotAllowed().finish(),
    }
}

/// Build up the database connection URL from environment variables.
fn db_url_from_env() -> String {
    let host = std::env::var("MONGO_HOST").unwrap();
    let port = std::env::var("MONGO_PORT").unwrap();
    let user = std::env::var("MONGO_ROOT_USERNAME").unwrap();
    let pass = std::env::var("MONGO_ROOT_PASSWORD").unwrap();

    return format!(
        "mongodb://{}:{}@{}:{}",
        user, pass, host, port,
    )
}

/// For some time try connecting to database and exit current process if it fails.
async fn try_initialize_database() -> mongodb::Client {
    let mut tries = 0;
    let db_url = db_url_from_env();

    println!("Connecting to database '{db_url}'...");
    loop {
        println!("Try #{tries}");
        if tries > 3 {
            println!("Failed connecting to database");
            std::process::exit(1);
        }

        if let Ok(database_client) = mongodb::Client::with_uri_str(
                &db_url
            ).await
        {
            // Test that the client works.
            if let Ok(db_names) = database_client.list_database_names(None, None).await {
                for db_name in db_names {
                    println!("{}", db_name);
                }

                return database_client;
            }
        }

        tries += 1;
    }
}

#[tokio::main]
async fn main() -> Result<(), std::io::Error> {

    env_logger::init_from_env(
        env_logger::Env::new().default_filter_or("info")
    );

    let database_client = try_initialize_database().await;

    let device_collection = database_client.database("wasmiot")
            .collection::<model::device::Device>("device");
    let module_collection = database_client.database("wasmiot")
            .collection::<model::module::Module>("module");
    let deployment_collection = database_client.database("wasmiot")
            .collection::<model::deployment::Deployment>("deployment");

    let (orchestrator_daemon, orchestrator_api) =
            WasmiotOrchestrator::start(
                device_collection, deployment_collection
            ).await;

    let handler_orch_api = web::Data::new(orchestrator_api.clone());

    HttpServer::new(move || {
        App::new()
            // Enable access-logging.
            .wrap(middleware::Logger::default())
            // Map orchestrator API to HTTP endpoints.
            .service(
                web::scope("/api")
                    .service(
                        web::scope("/device")
                            .configure(api::device::configure)
                            .app_data(handler_orch_api.clone())
                    )
                    .service(
                        web::scope("/module")
                            .configure(api::module::configure)
                            .app_data(web::Data::new(module_collection.clone()))
                    )
                    .service(
                        web::scope("/manifest")
                            .configure(api::deployment::configure)
                            .app_data(handler_orch_api.clone())
                    )
            )
            .default_service(web::to(default_handler))
    })
    // TODO: Add an environment variable where to set the amount of threads.
    .workers(1)
    .bind(("0.0.0.0", 8000))?
    .run()
    .await?;

    // Signal and wait for daemon to return.
    orchestrator_api.shutdown();
    orchestrator_daemon.await?;

    Ok(())
}
