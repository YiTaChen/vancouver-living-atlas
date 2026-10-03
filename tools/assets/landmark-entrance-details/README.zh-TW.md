# B04：Waterfront／Marine 入口局部

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: [Vancouver Living Atlas Noncommercial Research and Attribution 1.0](../../../LICENSE)

此包只製作 `AI_AGENT_DEVELOPMENT_BACKLOG.md` B04 第一組離線候選。沒有改 `public/`、城市 consumer、地標外殼、collision、原建築 placement 或發布預設。最終狀態與數字以 `manifest.json`、`qa/handoff.json`、`qa/validation.json` 為準；WebGL、城市效能與正式整合均 `not_run`。

## 實際交付

六個獨立模板，各有三份可編輯、壓縮 `.blend` 和三個普通 glTF 2.0 `.glb`：

- `waterfront-column`：半徑 0.6 m、高 8 m；近景原創淺槽在既有包絡內
- `waterfront-capital`：1.6 × 0.35 × 1.6 m；柱頭底部 local Y=0，組裝放 f+7.825，不誤用 f+8 當底部
- `waterfront-pediment-moulding`：28 × 3.5 × 0.24 m 三角線腳；保留原山花實心底板，近景齒飾不超出既有正面輪廓
- `waterfront-window-recess`：3.32 × 5.32 × 0.24 m 淺階梯窗框，真實 mesh 洞口 3 × 5 m；圍繞現有上層玻璃，不挖開城市牆、不新增室內。LOD0／1 同為 64 tris，便宜且保留完整凹槽；LOD2 32 tris
- `marine-archivolt-relief`：四層／兩層／單層陶色拱圈與原創幾何人字紋。不是對照片雕塑或藝術作品的複製
- `marine-copper-grille`：凹入至 local Z=-1.2 m 的上亮子格柵；獨立銅色 role，不合併現有玻璃／門片／夜燈

所有原始來源直接保存可編輯 mesh components、公尺 UV、具名材質 nodes；不是從 GLB 逆建模。`build.py` 是原創生成器。每檔來源遠低於 20 MiB；不用刪除可編輯內容換取小檔案。

## 座標、組裝與保留邊界

1 unit = 1 m。Blender +Z up、-Y front；標準 exporter 一次轉成 glTF +Y up、+Z front。所有作者 mesh scale 為 1。不可再次旋轉軸向，也不能按輸出 bounds 重新置中。

`assembly-plan.json` 是正式交接入口，描述 source-local frame／具名來源 component，不列任意世界 XYZ：

- Waterfront 門廊：使用原 station/envelope group、六個 x=-12,-8,-4,4,8,12、既有 f 地板 datum；六柱與六柱頭替換原對應件。線腳加在原山花正面，不刪三角實心底板或 entablature
- 窗框先選一個既有上窗做 pilot。eligible source loop 列完整 x 值；13 個窗全部擴展另需 residency／畫面驗收。不可套到 2.8 × 4 m 下窗
- Marine：原 `MARINE_GROUND` facade edge [4,5] 的 C/U/N frame；用 `thresholdY - 0.16` lift 一次。拱洞半寬 2.55、起拱 3.7、弧高 2.82、頂 6.52 m。拱圈內緣使用外切折線，低 LOD 不用內切弦縮窄洞口；所有外凸 ≤0.24 m
- Marine 源拱圈、陶飾由新 ceramic 部件取代。銅格柵只取代上亮子條件；既有入口玻璃、門框、把手、旋轉門、lobby、夜燈保留。側陶牌下緣 0.42 m 避開既有 granite 腳座表面
- Marine 保留原封閉 `solidFootprints`。它仍是外部觀賞凹入，不是可進入建築。此包無導航、碰撞開口、進入 trigger 或新地板

## 材質與成本

三個共享 semantic roles：`landmark-sandstone`／`landmark-terracotta`／`landmark-copper`。每個模板單一 opaque primitive、backface culling。role 由名稱與 metadata 綁定，不按顏色猜用途。砂岩可由未來 consumer 綁既有 `sandstone`；Marine 兩 role 是具名、無貼圖的共用材質。保留線性色 tint 與粗糙度／金屬度，沒有烘焙光影，新增 unique maps／embedded images 均為 0。

`qa/measurements.json` 分開列下載 geometry bytes、source bytes、image bytes 與 instance-counted 成本。Portico 是完整六柱、六柱頭、一山花；Marine 是拱圈＋格柵；不是只量單柱後冒稱完整門廊預算。幾何下載通常可按模板快取；報表另列每實例重複下載的保守總和。primitive 數不等於 GPU draws，沒有 FPS 改善承諾。

## 重現命令（repository 根目錄）

需要 Blender 4.3.2+、Python 3；預覽合成需要 Pillow。一次只運行一個 Blender process，兩 threads。

```sh
# 由真正來源重新匯出到新的目錄，保留手改幾何、UV、材質；不跑 build.py
blender --background --factory-startup --threads 2 --python-exit-code 1 --python tools/assets/landmark-entrance-details/export.py -- --source tools/assets/landmark-entrance-details/source --output /tmp/landmark-entrance-reexport

# 驗證新匯出或本包
python3 tools/assets/landmark-entrance-details/validate.py --root /tmp/landmark-entrance-reexport
python3 tools/assets/landmark-entrance-details/validate.py --root tools/assets/landmark-entrance-details --report tools/assets/landmark-entrance-details/qa/validation.json
python3 tools/assets/landmark-entrance-details/test_validate.py
python3 tools/assets/package-contract/validate.py tools/assets/landmark-entrance-details

# 重開所有 source、重匯入實際 GLB、隔離幾何／UV／材質手改測試
blender --background --factory-startup --threads 2 --python-exit-code 1 --python tools/assets/landmark-entrance-details/audit_blender.py

# 實際 GLB 的 Cycles CPU 正／側／背／頂、三LOD正面、兩組裝四光照
blender --background --factory-startup --threads 2 --python-exit-code 1 --python tools/assets/landmark-entrance-details/render_previews.py
python3 tools/assets/landmark-entrance-details/compose_previews.py

# 僅在要重新生成全新預設 source 時；不可用此覆蓋手改來源
blender --background --factory-startup --threads 2 --python-exit-code 1 --python tools/assets/landmark-entrance-details/build.py -- --output /tmp/landmark-new-sources
```

`build.py`／`export.py` 拒絕已有輸出目錄。exporter 不儲存來源；有來源 edit 需先在獨立 output 跑全部檢查，核對後才將 sources/exports/manifest 一起換版。純 geometry/UV/Principled nodes 可編輯；不支援的材質 graph 會拒絕，避免假裝保留再靜默丟失。

## 檢查範圍與限制

- CPU：hash、node transforms、三角形／頂點／bytes、normals／UV／tangents、逐LOD尺寸／datum、primitive／role、有限值、重複三角形、洞口 ray 採樣、B-HERO 三LOD與完整組裝成本；反例包含錯軸、改原點、世界座標例外、Marine 升降／collision 漂移、假 WebGL pass、超額組裝及封閉洞口
- Blender：18 sources 重開、18 delivered GLB 真實重匯入；幾何 +0.013 m、UV +0.075、roughness 改 .52 的隔離手改保留實測
- 預覽：Cycles CPU，640² 部件及 960×640 組裝、16 samples、2 threads。此 Blender build 不含 OpenImageDenoise，明確關閉 denoiser。1 m 尺／1.75 m 與 1.81 m 人形是 QA-only；沒有任何 QA mesh、相機或燈輸出到 GLB
- 預覽不是城市照明：晴／陰／黃昏／夜為離線同相機研究。只畫交付部件，缺少保留的整棟外殼／地板是刻意的；不冒稱整個車站或完整 Marine Building
- 尚需整合 agent：source-owned selection、suppress 被取代舊件、材質共用、實際地面 threshold、LOD 距離／cache／釋放、WebGL 同相機四光照、walk/drive 接縫、collision 回歸及 production isolation。沒有測到的不寫 pass
