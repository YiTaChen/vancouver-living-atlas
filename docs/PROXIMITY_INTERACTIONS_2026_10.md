# 鄰近互動與實體座位（2026-10-22）

人物靠近可使用的座位時，座位旁顯示椅子圖示及目前語言的「坐下」。桌機附 F 提示，手機直接點按同一按鈕。坐下後改為「起身」。這次建立共用的鄰近互動入口，後續物件、人物及場景可以註冊自己的行為，沿用選取、提示、輸入與生命週期管理。

## 已接入的座位

| 場景 | 實作範圍與來源 |
| --- | --- |
| 城市街道 | 實際載入並可見的 cedar-bench 資產；座面高度從 shipping GLB 的 LOD0／LOD1 幾何核對為 0.509m，不使用椅背的整體 bounds。 |
| 可進入的建物 | 既有室內場景建造時明確登記的木長椅，沿用室內地面、朝向與可見狀態。 |
| 海灘 | 既有海灘設施建造時登記的坐木；座高依原有坐木的半徑與擺放計算，沒有把任意樹木當成座位。 |
| SkyTrain 車站 | 七站目前載入站體內、由實際長椅幾何建立的座位及其走道側起身點；同一樓層且接近時才提供互動。 |
| SkyTrain 車廂 | 搭乘車廂內有對應座面幾何的原有座位；從已載入的 Mark V／Canada 內裝、座位節點及材質批次建立乘客空間。 |

SkyTrain 上車後可在目前搭乘的單節車廂內沿走道行走，接近座位再坐下。地板邊界、椅子、扶手、隔板及車殼的實際三角形限制行走範圍；不提供跨車廂步行。到站須先起身、走近正確側門口，再使用既有下車操作。車站坐姿採已驗證的走道側觀看位置；車廂保留座位原有第一人稱視點。 乘車鏡頭會明確設定近裁切距離與視角，避免沿用城市遠景的 2m 近裁切而裁掉身旁車廂及互動提示；離開後交由步行模式接回鏡頭。

NPC 對話、多人座位爭用及其他場景的具體互動內容未在這次實作。既有公車／靜態車廂的視角預設仍沿用原流程，沒有將所有視角預設改寫成實體走近選座。

## 輸入與提示

- 桌機：靠近座位後按 **F** 坐下，再按 F 起身；亦可點擊座位旁提示。F 不接管重複按鍵、IME 組字、修飾鍵組合、文字輸入欄或對話框內的操作。
- 手機：點擊座位旁至少 48px 的按鈕；粗指標裝置使用至少 52px 高度。觸控標籤不顯示鍵盤 F，文字跟隨目前語言。
- SkyTrain 的樓層通行、上車及下車繼續使用 **E**／原有互動按鈕；F 專供目前的鄰近物件行為。
- 提示的世界座標由引擎投影到視窗，先從候選中排除視野外的物件，再選擇最近的可用座位，避免背後座位遮掉眼前的提示。坐下後若第一人稱看不到身旁座位，保留畫面中央偏下的「起身」備援提示，避免被困在座位。
- 選單、模式放置、靜態車廂展示、分頁暫停或不適用的交通模式會停用共用互動；恢復時重新查詢，不沿用先前可操作的目標。

`lib/i18n/interactions.json` 覆蓋 en、fr、es、zh-Hant、zh-Hans、de、ja、ko、uk、ru。`sit`、`stand`、`use`、`talk`、`inspect` 是目前的動作文字；SkyTrain 另使用 `walkCabin`、`cabinHint`。未知動作先顯示本地化的 `use`，新增具體文字時也要擴充提示元件的動作 key 對應。

## 架構與介面

| 所在檔案 | 責任 |
| --- | --- |
| `lib/city/proximity-interactions.ts` | 純資料合約、provider 登記、距離／優先序選取、穩定選取及執行前驗證；不依賴 Three.js 或城市 mesh。 |
| `lib/city/city-interactions.ts` | 引擎 host；註冊城市與 SkyTrain provider、提供人物腳底世界座標、管理單一 F listener、先過濾視錐再選取物件、投影提示並發布給獨立 React overlay。 |
| `lib/city/world-seats.ts` | 街道、室內及海灘的明確座位；16m 空間桶、局部查詢、接近與起身的地面安全檢查、已佔用街道椅的顯示保留。 |
| `lib/city/navigation.ts` | 城市人物的 `walkSeat`、坐下／起身、移動鎖定、姿勢與眼睛高度、交通模式切換。 |
| `lib/city/skytrain-travel.ts`、`skytrain-passenger-space.ts` | 車站與移動列車內的乘客座標、實體座位與走道碰撞、安全起身及旅程狀態。 |
| `components/city-interaction-overlay.tsx` | 訂閱提示位置與輸入狀態，讓相機移動只重繪這個小元件；解除訂閱後清理輸入。 |
| `components/proximity-interaction-prompt.tsx`／`.css` | 本地化的物件旁圖示及可點擊提示；鍵盤與觸控呼叫相同的引擎 dispatch。 |

核心合約：

```ts
type InteractionPoint = readonly [number, number, number];
type InteractionKind = 'seat' | 'object' | 'person' | 'scene';

interface InteractionCandidate {
  id: string;
  kind: InteractionKind;
  action: string;
  anchor: InteractionPoint;
  proximityPoint?: InteractionPoint;
  range: number;
  priority?: number;
  canInteract?(): boolean;
  execute(): boolean;
}

type InteractionProvider = () => readonly InteractionCandidate[];
```

`anchor` 是提示的視覺位置；`proximityPoint` 是實際互動距離基準，預設使用 `anchor`。傳給 `update(origin, enabled)` 的 origin 必須是人物腳底的世界座標，不能使用相機位置。移動列車每次都將車廂區域座標轉成當下世界座標。

`CityInteractions.registerProvider(id, provider)` 會為未來 feature 套用相同的視野規則；純資料核心的 `ProximityInteractionController` 提供 `registerProvider(id, provider)`、`update(origin, enabled)`、`snapshot()`、`execute()`、`clear()`、`dispose()`。登記回傳 idempotent 的解除函式。`snapshot()` 只公開 id、kind、action、anchor、distance，沒有 callback，React 不持有世界物件的執行權限。

選取依優先序、三維距離、provider／目標 ID 排序；同優先序加入預設 0.25m 的小幅保留範圍，降低相鄰座位提示跳動，但不延伸合法互動距離。坐姿的起身使用較高優先序。每個 provider 內的重複 ID、非有限座標及不合法距離不會成為目標。

## 執行與安全限制

1. 城市 host 在 F 或點擊發生時重新取得人物位置、模式與 provider 狀態，確認顯示的目標 ID／action 仍吻合。
2. 核心執行前再次查詢，重新驗證距離與 `canInteract()`；相同 provider 的同一 ID／action 才可執行。移動、消失、不可用或已更換動作的目標不能透過舊提示觸發；provider 重用可變 descriptor 也不會把舊「坐下」變成其他動作。
3. provider 負責自己的正確樓層、遮擋、可見狀態及安全轉換。城市座位檢查椅前接近路徑、可渲染地面及障礙；DEM fallback 本身不能授權坐下或起身。車站檢查 surface ID，列車使用目前載入車廂的局部地板與碰撞資料。
4. 坐下會清除已按住的移動輸入，固定人物座位位置與朝向並套用彎膝姿勢。鍵盤、搖桿及步進操作都不會讓坐著的人滑走。眼睛高度跟隨實際座面，起身後恢復站姿。 人物模型的內嵌貼圖使用正式 CSP 允許的圖片解碼路徑，保留原 PNG／PBR 材質；解碼失敗會釋放未完成模型並保留可用的備援人物。
5. 起身前必須找到同層且可站立的安全位置。出口被擋時保留坐姿；城市模式切換、重新放置及橋樑快速移動先嘗試安全起身，不能直接把坐姿搬到另一位置。列車在原走道站位安全時才允許起身。
6. 選取成功執行後清除，拒絕重入 dispatch。單一可選 provider 或 guard 失敗不影響其他 provider；解除、停用及銷毀會清理可執行狀態與事件。

## 接入未來 provider

provider 應由擁有場景物件的系統管理，回傳自己附近的少量候選，不要每 frame 遍歷整座城市的 mesh。ID 使用全域可辨識的前綴並保持穩定；判定與執行保持同步，避免在 callback 裡以非同步結果假裝立即成功。

```ts
const interactions = engine.interactions;
const unregister = interactions?.registerProvider(
  'feature-doors',
  () => nearbyDoors().map((door) => ({
    id: `feature-door:${door.id}`,
    kind: 'object' as const,
    action: 'use',
    anchor: door.promptWorld,
    proximityPoint: door.approachWorld,
    range: 1.4,
    canInteract: () => door.visible && door.safeToOpen(),
    execute: () => door.open(),
  })),
);

// 在對應場景移除或 owner 銷毀時先解除，再清理其物件。
unregister?.();
```

這是擴充介面示例，沒有新增門互動。若互動會鎖定人物或改變攝影機，該 feature 也需定義恢復、取消、模式切換及 owner 卸載時的狀態清理。

## 驗證與證據範圍

這次核心、提示及城市座位的針對性測試 **16／16** 通過，對應檔案也通過 `oxlint --type-aware --deny-warnings`。可使用 repo 支援的 Node 24.22.1 重現：

```sh
node --test tests/proximity-interactions.test.mjs tests/proximity-interaction-prompt.test.mjs tests/world-seats.test.mjs
```

涵蓋最近目標／穩定選取、改動後重新驗證、不同 callback／動作／距離、例外與回收、F 輸入 guard、實際提示 handler、十語系及觸控文字。城市座位測試讀取兩份 shipping cedar-bench GLB 的實際頂點，驗證座面高度、隱藏／背面／隔牆／錯層拒絕、安全起身、桌機與觸控移動鎖定、眼睛高度、交通模式及橋樑快速移動；另外以 1,500 個遠處明確座位確認查詢只處理本地候選。

引擎 host 的輸入／模式／視錐與起身備援位於 `tests/city-interactions.test.mjs`；兩種人物坐姿及載入後套用姿勢位於 `tests/citizen-seat.test.mjs`；SkyTrain 的實際車廂／車站碰撞、步行、座位及生命週期隨 `tests/skytrain*.test.mjs` 執行。本次 feature suite 89 項通過；最後補強的車廂接近限制再以 6 項實際模型測試及 2 項完整互動流程重跑通過。完整 repo 的本機回歸為 1,828／1,829；未變更的公車模型檢查遇到主機繁忙而觸發原有 watchdog，原樣單獨重跑已通過，未放寬檢查或改動模型。來源與結果收據在 `docs/qa/proximity-seats-20261022/automated-verification.json`。完整 CI、原生瀏覽器與部署結果依本次 PR 驗收紀錄判定；手機尺寸的瀏覽器操作不等同實體手機硬體測試。

`docs/SKYTRAIN_PASSENGER_TRAVEL_2026_10.md` 及既有 `docs/qa/skytrain-*` 的歷史原生畫面、效能、完整測試與 CSP 收據，屬於 `53bb3c6` 基準及其先前來源版本，保留原有來源指紋，不能轉用來宣稱此次鄰近座位／車內步行版本已完成同一項驗收。
