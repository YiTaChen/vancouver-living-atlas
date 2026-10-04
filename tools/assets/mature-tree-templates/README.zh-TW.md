# B03 成年樹模板：10 m 原創枝幹與葉簇

本包是獨立離線候選；正式 `public/`、城市 consumer、來源位置、人口、種子與高度皆未修改。最終狀態與實測數字以 `manifest.json`、`qa/validation.json`、`qa/handoff.json` 為準。離線完成不等於 WebGL 已驗收，也不代表近景畫質或 FPS 已優於正式版本。

## 交付內容與真正改動

四個具名物種：maple、alder、Douglas-fir、western-redcedar。每種各有 LOD0／1／2 原生可編輯、壓縮 `.blend` 與普通 GLB，共 12 個來源、12 個輸出。

這次從成年樹的主幹、主要分叉、次枝和樹冠包絡重新建立幾何，沒有匯回 GLB 假裝原始來源，也沒有放大既有約 1.25 m 的 sprig。闊葉採不對稱領幹與分叉樹冠；針葉保留中央領幹和分層放射枝條。葉簇以來源 seed 決定，新增葉面不會重抽主枝位置。這是對現有城市 envelope 的代表性原創造型，不是逐株測量或植物學掃描。

- `trunk`：主幹，保留可编辑 `leader-trunk` 頂點群組。
- `branches`：主枝和近景次枝，保留 `primary-*`／`secondary-*` 群組。
- `foliage-cards`：近景每簇多方向小葉面，中景保留同名抽樣簇，並做層級包絡調整，因此葉簇中心不是逐點完全相同；沒有數公尺單葉 billboard。每簇實際 bounds 寫入 `qa/leaf-cluster-bounds.json`。
- `foliage-core`：明確不透明內冠角色；第 2 版近景 maple／alder 改為五向 alpha-cutout 內層葉簇，完全移除可見的不透明圓滑內冠；其他物種／LOD 保留明確的低成本實體角色。低 LOD 不是葉面放大替代。

各 LOD 名称、地面原點和高度一致。主要來源 mesh、UV、材質節點、枝幹／葉簇 vertex groups 和 packed 原圖均保留；不是只交一張平面貼圖。

## 尺度、擺放与來源高度

- Blender：1 unit = 1 m、Z up。glTF：Y up；標準 exporter 只轉換一次 `(x,y,z) -> (x,z,-y)`。
- 地面接點在 `[0,0,0]`，完整實際高度為 10 m；冠寬約 4.6–4.9 m，水平半徑上限 2.85 m，樹冠下方至少 2.5 m 淨幹。
- `templateHeightM=10`，`normalizationMode=physical-template-source-height-divided-by-template-height`。
- 整合公式為 `uniformScale = sourceHeightM / 10`。22.9 m 來源只能乘 **2.29**，不能沿用目前正規化約 1 m 幾何直接乘 22.9 的 consumer 路徑。
- 為維持 0.8×1.6 m 樹皮週期，runtime 必須以同一 `sourceHeightM/10` 乘 bark UV（每實例參數）；leaf atlas UV 不變。不同高度仍共用貼圖，不能每棵克隆 texture。
- 同步等比縮放 trunk collision proxy、樹冠半徑及淨空；保留原 municipal/source ID、seed、位置、人口上限、道路 clearance 和遠景替換規則。不能把所有來源高度改成 10 m。
- QA 的 1 m 尺、1.75 m／1.81 m 人形、燈光、文字和相機全部在重匯入後另建，不出現在 runtime GLB。

## 葉片／樹皮與成本

葉 atlas 是既有 `vegetation_ground` 的原創 1024² straight-alpha PNG，內容 hash 相同。Bark 則由原有 512² maps 派生 256² base color／normal／ORM；normal 先解碼、縮小後正規化向量，再編回 +Y tangent normal。方法和來源 SHA 在 `qa/texture-derivation.json`。

四張 runtime PNG 只保存在 `exports/textures/` 一份；12 個普通 GLB 以同一 URI 引用，GLB 內嵌圖像 bytes 為零。來源 `.blend` 可各自 pack 圖像以便可靠編輯，不能把它們的來源檔大小當 GPU 成本。

整批 candidate 的保守 RGBA8 完整 mip 鏈成本為 **6.333 MiB**：葉 5.333 MiB，加三張 256² bark 共 1 MiB。此值把所有候選貼圖都算入 8 MiB 上限，沒有假設既有離線 maps 已在 production 常駐。與正式樹材質的實際 residency 差尚未量測；若新舊貼圖同時保留，必須另算。PNG 下載 bytes、GLB geometry bytes、image bytes 和 texel residency 分開列報。

葉片為 sRGB RGB＋線性 alpha coverage、MASK cutoff=0.4、雙面。不得再用舊 RGB 的 min-channel decoder；color、depth、shadow 必須遵循相同 mask。近景 maple／alder 的內外葉簇共用同一 MASK 材質；其他物種／LOD 的內冠仍為 OPAQUE。`materialBindings.levels` 明確區別，不混用舊 `aSolid`。Bark 不透明，公尺 UV 以實際 ring 周長／0.8、枝條弧長／1.6 建立；normal／ORM 用 linear／Non-Color，ORM R=1、G=roughness、B=0。

普通 GLB **沒有自動載入**既有 authored coverage mips。CPU 報告會量測 base coverage；細針葉在遠景的自動 mip、亮背景和陰影仍須整合驗收，不能把平均 alpha coverage 當成 crown silhouette 或 GPU 通過證据。

## 安全重匯出與重建

保留手工修改時只使用 exporter，輸出目錄必須不存在：

```sh
blender -b -t 2 --python-exit-code 1 --python tools/assets/mature-tree-templates/export.py -- --source tools/assets/mature-tree-templates/source --output /tmp/mature-tree-edited-package
```

Exporter 逐一讀取已存來源、保留 mesh／UV／object transform／支援的材質與 packed image 編輯，拒絕不支援的 shader graph，不重新生成樹木、不重寫 UV、不儲存來源。所有輸出寫入新的 package；source hash 必須保持不變。圖像按內容 hash 去重。若手工修改尺寸、物種 UV 或貼圖大小，仍需重跑整份 audit；成功輸出不是自動通過新尺度或預算。

以下是**會覆寫來源**的完整程序重建，用於明確放棄手改、重新生成：

```sh
python3 tools/assets/mature-tree-templates/prepare_textures.py
blender -b -t 2 --python-exit-code 1 --python tools/assets/mature-tree-templates/build.py
blender -b -t 2 --python-exit-code 1 --python tools/assets/mature-tree-templates/export.py -- --source tools/assets/mature-tree-templates/source --output /tmp/mature-tree-rebuilt-package
```

經驗證後再以新輸出更新本包 `exports/` 和 `manifest.json`，不可直接發佈至 `public/`。

驗證入口：

```sh
python3 tools/assets/package-contract/validate.py tools/assets/mature-tree-templates
python3 tools/assets/mature-tree-templates/validate.py
blender -b -t 2 --python-exit-code 1 --python tools/assets/mature-tree-templates/audit_blender.py
blender -b -t 2 --python-exit-code 1 --python tools/assets/mature-tree-templates/test_source_edits.py
blender -b -t 2 --python-exit-code 1 --python tools/assets/mature-tree-templates/audit_roundtrip.py
blender -b -t 2 --python-exit-code 1 --python tools/assets/mature-tree-templates/render_previews.py
```

渲染使用 Blender 4.3.2 Cycles CPU、單 process、2 threads、24 samples；目前 Blender build 沒有 OpenImageDenoise，因此不使用 denoising。使用實際 GLB 重匯入的晴／陰／黃昏／夜間，以及每物種三 LOD 圖。獨立 CPU raster 額外檢查 front／side 的 alpha-aware silhouettes，採 bilinear alpha、0.4 cutoff；這不是 WebGL screenshot。

## 交接順序與限制

1. 先在既有 source cohort 選定一株 broadleaf 和一株 conifer，保持 ID、seed、height、位置和 pool 數量，做 physical-template scaling adapter。
2. 以 materialBindings 和 SHA/URI 共用 maps／materials。source reuse 不代表 loader 已去重。測失敗載入、切換、cache 和 dispose。
3. 以相同相機檢查 10／30／65 m、四種光照、正側／掠射角、亮背景、陰影、LOD 邊界與樹種差異。
4. 保持來源道路淨空、碰撞與坡地接地；未通過不得大範圍取代正式樹木。
5. 量測 GPU frame time、overdraw、resident texture／geometry memory，再決定 LOD 距離和 source-seed 變體數。離線預算不等同全城 FPS。

版本 2.0.0 是離線材質角色契約變更：maple／alder 的 `foliage-core` 在 LOD0 改用 `foliage-straight-alpha`，LOD1／2 維持 `foliage-solid-interior`。consumer 必須按 node＋LOD 解讀 `materialBindings.levels`，不可僅按 node 名稱指定不透明 shader。原資產 ID、尺寸、來源 height 換算與四張 maps 不變；兩種 conifer 和 broadleaf LOD1／2 的 GLB 完全未變。

LOD1／2 的內冠是刻意簡化的實體量塊，近距不適用。現有葉 atlas 仍有概括化形態；本包主要改善主幹、枝條層級及葉面實體尺度，沒有宣稱掃描級樹種辨識或全城視覺已改善。

## 授權

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0

新增幾何與工具為此 repository 的原創開發；原 maps 沿用本專案來源。沒有第三方模型、照片、掃描或下載材質。不得把本包另標 CC0／MIT。

## 實測摘要

| 物種 | LOD0 / LOD1 / LOD2 triangles | 三 GLB 合計 bytes |
|---|---:|---:|
| maple | 7696 / 1284 / 222 | 882660 |
| alder | 7680 / 1284 / 222 | 881116 |
| douglas-fir | 7634 / 1680 / 188 | 673140 |
| western-redcedar | 7634 / 1680 / 188 | 673192 |

版本 2 的近景闊葉不再含不透明 crown surfaces；原有平滑團塊已由真正分層 alpha-cutout 葉簇取代。這項修正增加 alpha-tested surface overlap，不能推論 GPU overdraw 或 frame time 改善。

十二件實際高度仍為 10.000 m；四張 maps 共 6.333 MiB。細節與 hash 對照见 `qa/broadleaf-revision.json`。
