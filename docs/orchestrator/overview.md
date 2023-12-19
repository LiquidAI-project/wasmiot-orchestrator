# Documentation overview
The orchestrator uses [WebAssembly modules](/docs/modules.md) submitted through
[its API](/docs/orchestrator/api.yml) and [IoT-devices
found](/docs/orchestrator/discovery.md) via mDNS to create a
[solution](/docs/orchestrator/deployment.md) for connecting together
microservices. The solution is meant to be dynamic meaning that changes in the
functions or performance of IoT-devices leads to automatically re-solving, thus
keeping the application (composed from microservices) functional without the
need for human intervention.

This collection of documents gives more in-depth information on how this is
achieved at both conceptual and implementation-specific levels. The description
isn't all-encompassing and some things aren't yet implemented, so reading the
documentation alone is not sufficient for getting to know the system!

## Miscellaneous
### Orchestrator implementation notes
- [`fileserv/server.js`](fileserv/server.js) is the "main" program that connects
  to external database (MongoDB) and starts the server and device discovery.
  - The startup/initialization branches into the [`/fileserv/routes`](/fileserv/routes), that are initialized
    with references to database and device browser.
- There aren't many chosen or deliberate styles or patterns used (e.g., functional, OOP, MVC etc)
  so the different ways of expressing things (classes, JS-objects, named or anonymous functions etc)
  are quite mixed (and sometimes even messy)
- Frontend Javascript is even messier and it has been suggested to build some CLI client tool
  to interact with the server's JSON-API instead. For getting started with using the GUI see the [`fileserv` README](/fileserv/README.md). Building a CLI tool could be started by getting familiar
  with the `curl`-based scripts provided TODO as examples in the [one](/example/datalist) and [two](/example/fibo-store) examples.
- Prefer to use `async/await` for handling promises instead of stuff like this: `foo.then(bar => bar.then(baz => baz.then(...)))`
