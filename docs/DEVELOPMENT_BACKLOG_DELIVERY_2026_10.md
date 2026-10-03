# 2026-10-03 AI backlog 分批離線交付

來源規格：[AI_AGENT_DEVELOPMENT_BACKLOG.md](AI_AGENT_DEVELOPMENT_BACKLOG.md)。製作基準為 main `5574d55719f10d1575127d8b92cbd23ff71e446f`，不是先前資產批次的舊分支。此輪按規格的製作／整合分工執行：交付可編輯來源、普通 GLB、metadata、離線證據；尚未驗收的內容不進正式載入預設。

追蹤分支：`assets/development-backlog-oct3`；[draft PR #5](https://github.com/YiTaChen/vancouver-living-atlas/pull/5)。每個模型包在完成 package-specific Blender／CPU 檢查後才回填製作完成。共同工具或來源盤點完成不代表 27 項全部完成。

## 已完成的驗證基礎

[package-contract](../tools/assets/package-contract/README.zh-TW.md) 為新的 schema 1 包提供 read-only GLB 與檔案驗證：

- 來源／匯出 SHA-256、實際 geometry 成本、scene-node transform 後 bounds；不把作者端尺寸或 accessor min/max 當成已套用完整 transform 的尺寸。
- 17 個 GLB 正／反例與 2 個正式輸出隔離測試；`npm test` 自動執行 common regression，並驗證符合新契約的包。舊 schema 保持各自的 validator。
- 每包另有 Blender source／reexport／材質／datum／淨空／預覽的獨立驗證。common pass 不取代那些檢查。
- 正式輸出隔離 helper 比對新資產的實際 SHA-256 與 URL 名稱；不假稱做過瀏覽器 network 或 GPU 驗收。

基礎提交 `8b95f013297597845d542463d6ce635105a95c4f` 已通過 [GitHub CI](https://github.com/YiTaChen/vancouver-living-atlas/actions/runs/37155216117)。

## 驗證邊界

基準版本本機 `npm run check`、660/660 `npm test`、`npm run build:firebase` 與 landmark worker verifier 通過。既有 `npm run lint` 失敗，涵蓋原有 runtime／tests／tools 診斷；本離線分支不夾帶不相關的全庫 lint 重寫。新增測試／資產的最終結果依各批記錄，不沿用基準數字冒充新結果。

沒有在此環境完成 WebGL 場景、frame-time、GPU 記憶體、玩法或正式載入驗收。先前 main 文件的 GPU 結果只屬先前版本；此輪不重新宣稱它們是新資產的結果。後續整合者須核 source identity、datum、shared roles、LOD／cache／resource disposal、場景配置與實際畫面。

## 第一批可用離線包

| ID | 包與來源提交 | 製作狀態／實際證據 | 後續狀態 |
| --- | --- | --- | --- |
| 共通庫存 | [development-backlog](../tools/assets/development-backlog/README.zh-TW.md)，`58bcb8e3` | 27 ID、436 檔案指紋、63 GLB 容器、16 datum／語意契約；15 個測試 | 基準盤點，不算新模型或 runtime 完成 |
| B01 | [rooftop-equipment](../tools/assets/rooftop-equipment/README.zh-TW.md)，`ad1c849b` | `offline_complete`；3 種機組，6 個 .blend／6 GLB；LOD0 324／388／388 tris，LOD1 70／92／92；零圖像貼圖、每件2 primitives；48 次實際 GLB CPU 渲染、22 測試及手動編輯保留證據 | `runtime_pending_webgl`；屋頂 fitting／排除／shared-role／樣區消費器另驗收 |
| B02 | [roof-surface-studies](../tools/assets/roof-surface-studies/README.zh-TW.md)，`5e173f5a` | `offline_complete`；2 份可編輯材料來源、4 inspection GLB、10 CPU 預覽；真512px來源bake、六張256px共享候選maps合計2MiB規劃估算；8 測試及修改／重烘焙證據 | `runtime_pending_webgl`；256px極近拍柔化、取樣週期與城市平均明度需樣區驗收 |

B01/B02 來源已在 PR5 分支，不表示 main 或 Firebase 已採用。B02 inspection GLB 內嵌 maps 只是方便離線查看，正式整合要綁同一 surface cache；不能直接把四個 GLB 的私有貼圖都載入城市。
