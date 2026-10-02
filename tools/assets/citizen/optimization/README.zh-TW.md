# 市民角色：Blender 資產優化與整合交接

此目錄只交付資產，沒有替換 `public/`、沒有修改載入器、導航、群眾或動畫行為。請整合者自行選擇候選版本。

## 來源與可編輯性

- 唯一原始输入為目前發布的 `public/models/citizen/vancouver-citizen.glb`，SHA-256 見 `manifest.json`。原始造型、材質及動作由上層 `build_citizen.py` 生成，沿用專案 LICENSE，未引用外部角色或動捕。
- `source/citizen-reference.blend` 是從正式 GLB 重建的可編輯基準：網格、UV、22 骨架、權重、三段 baked actions、原始 2048 貼圖均保留。它不是遺失的原作者 `.blend`，也無法還原已烘焙的程序材質節點或原始細分歷史。原始程序產生器仍在上一層。
- 每個候選都有獨立、壓縮儲存、貼圖已打包的 `.blend`。QA 攝影機和燈光保留在 source，匯出時只選角色網格與骨架。

## 交付清單

- `glb/citizen-lod0.glb`：完整 37,799 三角形，三張 1024 貼圖。建議先整合此低風險版本：降低貼圖與下載成本，不減少骨架計算或三角形。
- `glb/citizen-lod1.glb`：只減面連續外套和牛仔褲，30,825 三角形、1024 貼圖，作為中距離候選。
- `glb/citizen-lod2.glb`：同樣只處理外套與褲子、較強減面（27,531 三角形），512 貼圖，供較遠距離評估。
- `source/citizen-{reference,lod0,lod1,lod2}.blend`：對應可編輯來源。
- `textures/Citizen_{BaseColor,Normal,Roughness}-{2048,1024,512}.png`：保留獨立貼圖；GLB 亦內嵌。1024 貼圖在 LOD0/LOD1 內容一致，但不同 GLB 並不自動共享 GPU 貼圖。
- `manifest.json`、`qa/glb-audit.json`：實際三角形、檔案大小、貼圖尺寸及估計記憶體。
- `qa/*-front.png`、`*-run-back.png`、`*-walk.png`：基準和候選固定鏡頭、固定光線比較。候選為最終 GLB 重新匯入的 Blender 渲染。
- `qa/*-tests.txt`、`qa/rig-comparison.json`：每個候選的權重／步態回歸、骨架姿勢比較。

## 減面策略與限制

先焊接 GLB 匯入產生的同位置頂點，保留每個 loop 的 UV。然後將兩塊大型連續外套／褲子表面單獨分離、減面，再合併；臉、頭髮、手指、鞋、領口、背包及細配件不做減面。骨架名稱與順序不變。減面後沿用原 generator 的解析式，重新計算腰部重疊布料的共同 pelvis 權重，避免外套與牛仔褲交錯。

曾測試更激進的全身加權減面，但實際跑步背面渲染出現背包／領口破壞，即使 CPU 步態測試通過仍淘汰，未作為交付版本。此例也說明數值測試不能取代視覺檢查。

1024/512 貼圖降低細布紋、拉鏈及髮絲銳利度；LOD1/LOD2 的衣服輪廓與皺褶也會改變，不能宣稱完全無損。512 不適合臉部近拍。固定跑步背面中，減面版本腰側可見小範圍深色／布料層邊界差異，褲腳與細接縫也會較粗；因此 LOD1/LOD2 只列中遠距離候選，近距離角色優先使用 LOD0，整合後仍需驗收相機距離。

未做 KTX2、Draco 或 Meshopt，因此不新增解碼器需求；尚未進入遊戲真實光線及目標手機／GPU 的性能實測。

## 座標／動畫契約

- 尺度：1 unit = 1 公尺；glTF 為 +Y up、+Z forward，鞋底約 Y=0.003m，身高約1.805m。Blender 編輯座標為 Z up／-Y forward。
- 一個 skinned mesh／一個 primitive／一個材質／22 bones；單角色基本一個 draw call，實際材質 pass 由應用決定。
- idle=2秒；walk=1秒、1m stride；run=0.8秒、1.9m stride。全部原地動作，位移仍由導航控制。
- 動作名稱維持 idle/walk/run；不要改變距離驅動採樣邏輯。角色與制服警察不是同一資產契約，不要直接重染整張 atlas。
- Texture MiB 以 RGBA8、完整 mip chain、三張貼圖估算：2048=64 MiB、1024=16 MiB、512=4 MiB。此數字不含網格、骨架、其他物件或解碼期間 CPU 記憶體，不等於實測 VRAM。
- 未加入 LOD 選擇或 fade、共享快取、SkeletonUtils 群眾克隆、動畫凍結或遠距離 billboard。這些屬使用者後續 runtime 整合。

## 重建與驗證

在 repo root 執行（Blender 4.3.2；Python 圖片檢查需 Pillow；Node 使用專案既有 three）：

```sh
blender -b -t 4 --python tools/assets/citizen/optimization/build_optimized.py
blender -b -t 4 --python tools/assets/citizen/optimization/export_from_blend.py
blender -b -t 4 --python tools/assets/citizen/optimization/render_exports.py
for level in 0 1 2; do
  CITIZEN_ASSET_PATH=tools/assets/citizen/optimization/glb/citizen-lod$level.glb node --test tools/assets/citizen/optimization/validate-citizen.test.mjs
done
node tools/assets/citizen/optimization/compare-rig.mjs
python tools/assets/citizen/optimization/audit_glb.py
python tools/assets/citizen/optimization/finalize_manifest.py
```

回歸保留原專案的正規化權重、尺寸／朝向、40個時間樣本×3動作的鞋底接地／小腿接合、衣服共同 pelvis 檢查；只為 LOD 放寬最低三角形門檻。額外比較每段動作40樣本的全部22骨骼世界矩陣，並檢查 UV／法線／位置／權重皆為有限值。這是有限樣本驗證，不代表所有任意混合姿勢或 retarget 都已驗證。

## 本次實測結果

- LOD0：37,799 tris／3,498,312 bytes，GLB 比原始小47.5%，貼圖估算16 MiB。
- LOD1：30,825 tris（減18.5%）／3,222,256 bytes，貼圖估算16 MiB。
- LOD2：27,531 tris（減27.2%）／2,001,060 bytes，貼圖估算4 MiB。
- 三個候選各4項既有回歸全數通過，實際讀入各自GLB，沒有使用默认正式資產代替。
- 三個候選的22骨骼順序一致；3動作×40樣本最大世界矩陣元素差7.0812e-7；idle/walk/run時長保留。
- 三個最終 `.blend` 已重新開啟匯出，再用 Three.js 讀取檢查，並重新匯入Blender完成正面、步行、跑步背面渲染。
