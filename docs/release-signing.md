# Release signing

E-Reader 1.0.0 is an unsigned local development release. The NSIS installer and installed executable therefore show an unknown publisher and can trigger Windows SmartScreen. No attempt is made to bypass or suppress that warning.

For a public release:

1. Purchase an organization-validated or extended-validation Windows code-signing certificate from a trusted CA.
2. Store the private key in an approved hardware token or CI secret store; never commit it.
3. Configure electron-builder signing through its documented certificate environment variables.
4. Timestamp signatures using the CA's RFC 3161 timestamp service.
5. Verify both the installer and installed `E-Reader.exe` with `Get-AuthenticodeSignature` and `signtool verify /pa`.
6. Publish the SHA-256 checksum through a channel independent of the binary download.

Auto-update is intentionally absent from V1. A future updater must verify signed update metadata and payloads before installation.
