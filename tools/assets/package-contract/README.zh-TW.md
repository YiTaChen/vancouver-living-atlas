# 新版離線資產共通驗證器

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: [Vancouver Living Atlas Noncommercial Research and Attribution 1.0](../../../LICENSE)

此工具是 2026-10-03 待開發規格的新包共通檢查，不改寫任何舊 manifest。

`python tools/assets/package-contract/test_validate.py` 執行正／反例。

`python tools/assets/package-contract/validate.py tools/assets/<package-id>` 檢查必填欄位、來源與 GLB hash、實際 GLB 尺寸／三角形／頂點／primitive／bytes。Node T×R×S／matrix 在場景樹只套用一次；可發現循環、多 parent、越界 indices、非有限資料、退化面及遺留 QA 相機／燈光。Geometry bytes 是完整 GLB 減嵌入 image payload（仍包含 JSON／padding），不是 GPU buffer allocation。

每 LOD 必須提供 level、file、sha256、source、sourceSha256、triangles、vertices、primitives、bytes、boundsM。asset.source 為主要 LOD0 可編輯來源，其餘來源由各 LOD 指定。材質 roles／通行淨空／source 重開與保留手動編輯重新匯出／Cycles CPU 預覽仍由各包 validator 驗證。**共通 pass 不等同整包 offline_complete。**

外部 PNG 必須為 GLB 所在目錄內的相對檔案。共享 texture catalog 若在其他目錄，使用具名角色佔位材質並在 manifest 宣告由 consumer 綁定，不從 GLB 使用任意跨目錄 URI。RGBA8 完整 mip 的數值僅是保守估算；authored mip chain 由包自身按級數計算。

未實作 sparse accessor、外部 BIN 或壓縮幾何擴充的解碼；遇到這些會明確拒絕而不猜測。Skinned GLB 只量 rest-pose node bounds，不宣稱動畫包絡／inverse-bind／角色姿勢已驗證。負 determinant node transform 需包專用檢查，不默許翻面。此工具不要求合法 glTF 軸轉換節點歸零。

沒有瀏覽器 WebGL、frame-time、GPU 記憶體、場景 source placement 或正式部署驗收能力。

## 正式輸出隔離

先執行正常 `npm run build:firebase`，再執行：

`python tools/assets/package-contract/verify_isolation.py tools/assets/<package-id>`

此額外檢查按指定新包實際 GLB／PNG／blend 的 SHA-256 搜尋 dist/client，並檢查 JavaScript／HTML／JSON／CSS 中的新包名稱與 GLB 檔名。它可發現重新命名但位元相同的誤拷貝；不宣稱偵測經轉碼的圖片或執行瀏覽器 network QA。若新包引用已正式採用的共用貼圖，不能把那些正式內容列成新包的禁止 payload；應僅在 manifest 引用，避免複製。測試：`python tools/assets/package-contract/test_isolation.py`。
