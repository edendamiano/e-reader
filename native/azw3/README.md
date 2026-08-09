# AZW3 normalization sidecar

Phase 0 uses `libmobi` v0.12 at commit `85dcfe803fc2a21020ddcf15c3eb66b93d388add` as a replaceable command-line sidecar. `mobitool.exe` dynamically loads the adjacent `libmobi.dll`; the application invokes it with a fixed argument vector and never through a shell.

The verified Windows build uses MinGW GCC 13.2.0 and CMake:

```powershell
cmake -S . -B build-shared-zlib -G Ninja `
  -DCMAKE_BUILD_TYPE=Release `
  -DBUILD_SHARED_LIBS=ON `
  -DTOOLS_STATIC=OFF `
  -DUSE_LIBXML2=OFF `
  -DUSE_ZLIB=ON `
  -DUSE_ENCRYPTION=OFF `
  -DCMAKE_C_COMPILER=C:/Strawberry/c/bin/gcc.exe
cmake --build build-shared-zlib --target mobitool --config Release
```

`USE_ENCRYPTION=OFF` is deliberate: the reader detects and rejects protected input but contains no decryption route. zlib 1.3.1 is statically linked into `libmobi.dll`; its permissive license notice is retained beside the LGPL notice.

Verified Phase 0 binaries:

| File | SHA-256 |
|---|---|
| `bin/mobitool.exe` | `3F5CFBAA9ED1C277FDF2337A5713A648107CA24C523E73DDB29C48153A5392DF` |
| `bin/libmobi.dll` | `742B3257980EAB43FCC55BA3E01380FE7D83594C400F432ECACABA593BCDAC57` |

Licenses:

- `libmobi`: LGPL-3.0-or-later, see `LICENSE.libmobi-LGPL-3.0.txt`.
- `zlib` 1.3.1: zlib License, see `LICENSE.zlib-1.3.1.txt`.
