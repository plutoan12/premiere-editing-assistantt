# Vendored runtime files

These files are copied without modification. Preserve their upstream notices.

| File | Upstream revision | SHA-256 | Notice |
| --- | --- | --- | --- |
| `CSInterface.js` (v10.0.0) | [Adobe-CEP/Samples `e4946b73ac1e566dced8e95dba10811c31036927`](https://github.com/Adobe-CEP/Samples/blob/e4946b73ac1e566dced8e95dba10811c31036927/PProPanel/lib/CSInterface.js) | `0416e8dd0050296fac0b44e40ad02c266e280739bac1fbbca8e298b64de06853` | Adobe copyright and SDK notice in file; Samples repository MIT license copied as `Adobe-Samples-LICENSE.txt`. |
| `json2.js` (2023-05-10) | [douglascrockford/JSON-js `7e83f38a2312429fd4933169c1f6a27fd65e889c`](https://github.com/douglascrockford/JSON-js/blob/7e83f38a2312429fd4933169c1f6a27fd65e889c/json2.js) | `86df14b56572e68a7e10b18e71804cb78c6890a7d6e534324822c23d12e858a2` | Public Domain, no warranty, as stated in the file. Used by ExtendScript bootstrap only. |
| `Adobe-SDK-License.pdf` | [Adobe-CEP/CEP-Resources `ab5e4e3e53a42fad08e1225a22a991bb1ffe73f6`](https://github.com/Adobe-CEP/CEP-Resources/blob/ab5e4e3e53a42fad08e1225a22a991bb1ffe73f6/License/GenSDK_IHC-en_US-20120323_1224.pdf) | `32e814081efd3495074202f7f8717aad14743b2d17b55298e92d7c4ece495383` | Adobe Software Development Kit License for Common Extensibility Platform. |

`CSInterface.js` supplies the official `evalScript` and `getSystemPath` bridge. The CEP engine supplies `window.cep.fs`; `CEPEngine_extensions.js` is deliberately not bundled because Adobe documents it as an engine-provided implementation. The signing SDK is a separate build tool governed by Adobe SDK terms, and is not included in the plugin or described as MIT software.
