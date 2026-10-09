# 原創低成本背景行人

Based on Vancouver Living Atlas by YiTaChen. Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: repository LICENSE, Vancouver Living Atlas Noncommercial Research and Attribution 1.0.

本包獨立製作四種原創背景輪廓，每型兩個 LOD；不複製 citizen 或第三方人物。GLB 為單一合併 mesh、單一 opaque vertex-color 材質，零貼圖、零 VAT、零骨架。LOD0 是中距背景，LOD1 是遠距背景，不是近距互動角色。所有尺寸使用公尺，腳底 Y=0、+Z 朝前、-X 是人物右側。

## 來源與匯出

- `build.py`：從空場景建立真正可編輯 `.blend`，沒有匯回 GLB 冒充來源。只有明確重建才使用；日常修改使用 `export.py`。
- `export.py`：重新開啟現有 `.blend`、保留手動編輯後匯出到全新目錄，不呼叫 generator。
- `audit_sources.py`：重開八份來源、核對屬性與 geometry，並在暫存來源平移 0.01 m，證明修改保存且重匯出仍存在。正式來源 hash 不變；正常重新匯出的 GLB 與候選 bytes 相同。
- `render_previews.py`：實際 GLB 重新匯入後以 Cycles CPU 渲染；1 m 尺與 1.75/1.81 m 參考人不進 runtime GLB。
- `package_utils.py`：直接讀取實際 POSITION、_LIMB、_PIVOT_*，計算解析式動畫 bounds。
- `finalize.py`：從實際檔案寫入既有 schemaVersion 1 共通契約，不改任何舊包。正式交付必須再通過 validate 與 Node tests；不得只執行 finalize 就宣稱完成。

從 repo root 執行：

```sh
# pristine rebuild to NEW directory, never overwrite manual source edits
blender -b -t 2 --python-exit-code 1 --python tools/assets/city-life-pedestrians/build.py -- --out /tmp/city-life-pedestrians-fresh
# source-preserving reexport to NEW directory
blender -b -t 2 --python-exit-code 1 --python tools/assets/city-life-pedestrians/export.py -- --out /tmp/city-life-pedestrians-reexport-NEW
# existing-candidate validation (no rebuild)
python3 tools/assets/city-life-pedestrians/validate.py
node --test tests/city-life-pedestrian-assets.test.mjs
# full Blender audit and CPU previews
blender -b -t 2 --python-exit-code 1 --python tools/assets/city-life-pedestrians/audit_sources.py
blender -b -t 2 --python-exit-code 1 --python tools/assets/city-life-pedestrians/render_previews.py
```

Blender 4.3.2；GLB 為不壓縮 glTF 2.0。重新生成 geometry/GLB 可重現，`.blend` 容器的位元 hash 另按實際保存結果記錄，不假設跨 Blender 版本 byte-identical。

## 動畫與整合契約

`_LIMB` 為 0 軀幹、1 頭、2/3 左右手臂、4/5 左右腿。`_PIVOT_X/Y/Z` 是已採 glTF +Y-up 的 scalar 公尺值，不得再套 Blender 軸轉換。`_PALETTE` 為 1 皮膚、2 上衣、3 下衣、4 鞋、5 頭髮、6 配件。配件與帽子已合併到相同 mesh。COLOR_0 使用 RGB；opaque 材質的 alpha 固定為 1。

`motion.mjs` 是 CPU 參考；`rigid-limb.glsl` 是相同公式的共享形變函式。walk 旋轉剛性四肢，idle 使用中立姿勢，look 旋轉頭部，yield 提供輕量看向與手臂反應。路徑偏移由 controller 負責，不藏進 vertex 動畫。沒有指引或坐姿 clip；pelvis 只提供未來對位錨點。

法線必須與 position 同步旋轉，color、AO、normal 及啟用的 depth pass 必須用相同形變。manifest 的 animatedBoundsM 以匯出頂點做區間極值，涵蓋四肢 ±0.42 rad、頭部 ±0.75 rad、root lift 0–0.051 m，另加 0.002 m 浮點餘量。Node tests 以多組 phase、walk/yield 混合及頭部 yaw，檢查實際頂點在包絡內，並將形變後法線與形變後三角形叉積比較。這些是 CPU 檢查，不是 GPU pass 一致性證明。

預定八份共享 geometry 與一份相容共享 material，最多八個背景主 pass 提交；實際 WebGL draw 數未量測。資源以 package/cache owner 管理，不逐人 dispose。保留 actorId、palette、phase 與路徑進度，instance slot 不等於人物身份。碰撞是簡單 torso capsule，不是包或手臂的精確體積。背景不投動態陰影，也未加入接地透明光斑。

## 驗證與狀態

離線交付 `offline_complete`；整合仍為 `runtime_pending_webgl`。詳見 `qa/validation.json`、`qa/source-audit.json`、`qa/preview-index.json`、`qa/measurements.json`、`qa/visual-review.json` 與 `qa/handoff.json`。三份靜態預覽是實際 GLB 重匯入的正面/背面，包含尺寸比較；不是瀏覽器畫面。

未實作近距骨架、坐姿/指引、正式 InstancedMesh consumer、各 GPU pass 一致性、同層配置、坡面腳步、生命週期與效能驗收。稜角與剛性四肢是刻意的背景風格；不能宣稱高精度近距人物或运行中已無穿插。Root lift 是便宜步態近似，不是 inverse kinematics；城市地面貼合仍待 runtime 檢查。離線完成不能當作 V02/V03 或全規格完成。
