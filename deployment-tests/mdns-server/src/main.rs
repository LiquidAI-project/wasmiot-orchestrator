use log::info;
use std::{any::Any, sync::Arc, time::Duration};
use zeroconf::{
    prelude::{TEventLoop, TMdnsBrowser},
    MdnsBrowser, ServiceDiscovery, ServiceType
};

fn main() -> zeroconf::Result<()> {
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .init();

    let name: String = "webthing".to_string();
    let protocol: String = "tcp".to_string();

    let service_type =
        ServiceType::new(&name, &protocol).expect("invalid service type");

    let mut browser = MdnsBrowser::new(service_type);
    browser.set_service_discovered_callback(
        Box::new(
            |result, context| {
                on_service_discovered(&result, context);
            }
        )
    );

    let event_loop = browser.browse_services()?;
    loop {
        event_loop.poll(Duration::from_secs(0))?;
    }
}

fn on_service_discovered(
    result: &zeroconf::Result<ServiceDiscovery>,
    _context: Option<Arc<dyn Any>>,
) {
    info!("Service discovered: {result:?}");
}
