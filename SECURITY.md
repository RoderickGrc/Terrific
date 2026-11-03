# Security

terrific-cli will keep all session data on the local machine. It will send nothing to remote services.

The daemon will bind to `127.0.0.1` only. Every route except `/ingest/*` will require a token in an `Authorization` header (a header, not a cookie, so a page cannot send it) and will reject a `Host` other than `127.0.0.1:<port>` or `localhost:<port>`, which blocks DNS rebinding. `/ingest/*` URLs will be unauthenticated and protected only by a random token in the path; they will answer CORS for any origin because instrumented apps post from their own dev server, and they will cap bodies at 1 MB. On macOS and Linux the token file will be created with mode 0600. Credentials and cookie states will never be logged or exported.

Report vulnerabilities privately through GitHub security advisories of this repository.
