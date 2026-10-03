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

## 城市來源、立面接口與第二批 Blender 包

| ID | 包與來源提交 | 本批完成的範圍 | 尚未完成 |
| --- | --- | --- | --- |
| A01／A03／A04 | [city-scale-audit](../tools/assets/city-scale-audit/README.zh-TW.md)，`6081b2c8` | 來源規則與實際 CPU 對照；7,630 solids、7,794 accepted parts ledger、時鐘與交通／水面時間分離、24 條 CoV 橋面來源路徑證據，12 測試 | 不等同 renderer／新橋件／WebGL 優化；21 OSM 橋段只有既有provenance，缺原始acquisition對照 |
| A02 | 同上 | 既有地表來源／GLB／材質契約量測 | `partial`；尚缺本需求專用10m地表試片與新consumer，不能把小坡面鋪成城市 |
| B03 | [mature-tree-templates](../tools/assets/mature-tree-templates/README.zh-TW.md)，`752cd68b` | `offline_complete`；4樹種×3LOD，12份真.blend和12GLB；10m模板，冠幅4.67–4.78m；近景闊葉改為分層masked葉簇；候選全部唯一maps6.333MiB估算 | `runtime_pending_webgl`；尺寸及bark UV倍率都為sourceHeightM/10，leaf atlas UV不動；普通GLB沒有載入authored coverage mips，透明overdraw／LOD變化仍需實測 |
| B04 | [landmark-entrance-details](../tools/assets/landmark-entrance-details/README.zh-TW.md)，`998d4a21` | `offline_complete`；6類×3LOD，18份.blend／18GLB，44張CPU預覽；Waterfront組裝7380/1800/264tris，Marine1916/868/348tris；15測試 | `runtime_pending_webgl`；Marine仍為封閉觀賞凹入，沒有新增可進入能力 |
| C01–C03 | [facade-fit-contracts](../tools/assets/facade-fit-contracts/README.zh-TW.md)，`6081b2c8` | `offline_contract_complete`；參照16類既有件、38GLB；1200 opening rays、48包測試和25既有consumer回歸；重播88個source-selected sill fit | `runtime_pending_webgl`；兩個實際窗洞不適配既有框，拒絕且保持fallback，尚不能宣稱整段立面已升級 |

對32個低於2m的來源solid既有clamp，以及1121個building foundation受part排序影響的案例，audit保留精確來源ID與差值，沒有為讓測試通過而擅自改動GIS或碰撞。

驗證器曾把無GLB的source-audit schema誤送進model validator，CI因此失敗一次；`8d07c4cd` 已改成明確schema分流，執行真正的city-source及facade-fit審核，沒有放寬GLB檢查。該修正與B03最終版本的[精確HEAD CI](https://github.com/YiTaChen/vancouver-living-atlas/actions/runs/37160159829)均已成功。

## 仍在進行／交接給整合的項目

- C04／F03：地表接界與小植栽來源包尚待交付。
- D01–D05：站點研究layout、公車及metro內外裝／門／座位／moving-frame metadata逐包製作與驗證；尚未發布的包不可引用為已交付。
- D06：由WebGL整合者開發並驗收停靠／上下車／乘坐流程；資產包完成不代表搭乘功能完成。
- E01：車流模型已完成第二輪離線驗證，正在核對來源交付；F01／F02已交付，見下。
- E02／E04／F04／F05：Roadster／室內UV與roles、角色變體及素材接口仍需後續批次；不能按`leather`名稱把駕駛頭部當皮革座椅。
- E03：只處理能指出具體缺口的港口／航空局部，保留原有有效的曲面與動力學datum；尚未以『不是.blend』為由重建任何載具。

本清單逐批更新。所有尚未完成或未測項目保持可見，沒有把來源包推到GitHub等同完成main部署或城市runtime採用。

## F01／F02 街道傢具交付

[street-furniture-expansion](../tools/assets/street-furniture-expansion/README.zh-TW.md)，來源commit `6d9e05c0`：8類傢具（長椅、歷史燈、獨立8m幹道路燈、候車亭、垃圾桶、消防栓、自行車架、防撞柱），16份可編輯.blend與16GLB，共781,256 GLB bytes、零圖像maps。尺寸、LOD、淨空、source保留、13個placement fixtures及12個反例測試通過；88次真正GLB重匯入CPU渲染編成16張審查圖。

此批 `offline_complete / runtime_pending_webgl`。原長椅腿距地面約3cm，新增可編輯接地鞋而不移動0.48m座面；保留4.49m歷史燈和4.56×2.82×1.86m亭外框。代表性位置提案未啟用任何世界實例，diffuser角色也沒有自帶point light。來源[精確HEAD CI](https://github.com/YiTaChen/vancouver-living-atlas/actions/runs/37160963678)成功。
