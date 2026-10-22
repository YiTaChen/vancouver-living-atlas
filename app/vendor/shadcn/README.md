# shadcn Tailwind helpers

`tailwind.css` is copied unchanged from `shadcn@4.18.0` (`dist/tailwind.css`),
licensed under the accompanying MIT `LICENSE.md`.

Source: https://registry.npmjs.org/shadcn/-/shadcn-4.18.0.tgz

The tarball was checked against the original lockfile SHA-512 integrity:

```
sha512-tUFZgkYmfVNQVm3xX7lhSzOvDsp+O14ac5dwgXIr5mIsr79ISueb/Mu+ZtWMz0DH6v77u4eYyvbQ9TTMpSn3aw==
```

Only this stylesheet is needed by the application. Vendoring it preserves the
existing Tailwind variants while avoiding installation of the unused generator
CLI and its vulnerable transitive build tools. Do not change the stylesheet
without updating its version/provenance and preserving its license.

The same license is published at `/licenses/shadcn-MIT.txt` with the static demo.
