# Gemini 이미지 생성 프롬프트 — 타워·몬스터·보스

이 문서의 이미지만 Gemini로 생성합니다. 배경·맵·UI·투사체·이펙트·성(기지)은 코드로 그립니다.
게임 세계관: 몬스터는 **'망각의 괴물'** — 아산의 역사를 지우려는 귀엽고 장난스러운 존재들. 특정 국가·인물을 적으로 그리지 않습니다.

## 1. 자산 목록과 파일명 (프론트 `frontend/public/assets/`)

### 필수 13장

| 파일명 | 대상 | 최종 크기 | 시점 |
|---|---|---|---|
| `towers/tower_onsen.png` | 온천 타워 (1단계 온양온천) | 256×256 | 3/4 정면 위 |
| `towers/tower_piri.png` | 피리 타워 (2단계 맹사성) | 256×256 | 3/4 정면 위 |
| `towers/tower_geobukseon.png` | 거북선 타워 (3단계 이순신) | 256×256 | 3/4 정면 위 |
| `towers/tower_bell.png` | 종탑 타워 (4단계 공세리 성당) | 256×256 | 3/4 정면 위 |
| `towers/tower_mansae.png` | 만세 망루 (5단계 선장 4·4) | 256×256 | 3/4 정면 위 |
| `enemies/enemy_slime.png` | 먹구름 슬라임 (기본) | 192×192 | 측면, 오른쪽 보기 |
| `enemies/enemy_bat.png` | 안개 박쥐 (빠름) | 192×192 | 측면, 오른쪽 보기 |
| `enemies/enemy_golem.png` | 바위 골렘 (단단함) | 192×192 | 측면, 오른쪽 보기 |
| `enemies/enemy_ghost.png` | 잉크 유령 (반투명) | 192×192 | 측면, 오른쪽 보기 |
| `enemies/enemy_dokkaebi.png` | 지우개 도깨비 (무리) | 192×192 | 측면, 오른쪽 보기 |
| `enemies/enemy_golden_slime.png` | 황금 슬라임 (보너스) | 192×192 | 측면, 오른쪽 보기 |
| `enemies/boss_mid.png` | 중간보스 먹구름 대왕 슬라임 | 320×320 | 측면, 오른쪽 보기 |
| `enemies/boss_final.png` | 최종보스 망각의 용 | 320×320 | 측면, 오른쪽 보기 |

### 선택 6장 (있으면 더 풍성해짐)

| 파일명 | 대상 | 최종 크기 |
|---|---|---|
| `enemies/boss_mid_s1.png` ~ `boss_mid_s5.png` | 스테이지별 중간보스 변형 5종 | 320×320 |
| `base/base_castle.png` | 지켜야 할 성(기지). 없으면 코드로 그림 | 320×320 |

## 2. 생성 요령 (일관성이 가장 중요)

1. **한 세션에서 한 번에** 생성하고, 아래 `STYLE` 문장을 **모든 프롬프트 맨 앞에 똑같이** 붙입니다.
2. 첫 이미지(온천 타워)를 만족스럽게 뽑은 뒤, 이후 프롬프트에 "Match the exact art style, outline thickness and color saturation of the previous image"를 덧붙입니다(참조 이미지 첨부가 되는 도구면 첨부).
3. 자산마다 2~3장 뽑아 **선 굵기·채도·비율(2~3등신)**이 가장 비슷한 것을 고릅니다.
4. 흰 배경으로 생성한 뒤 아래 3절 방법으로 배경을 제거합니다(Gemini가 투명 PNG를 직접 주지 못하는 경우가 많습니다).
5. 글자·로고·그림자·배경 풍경이 들어가면 다시 뽑습니다.

### STYLE (모든 프롬프트 공통 접두)

```
Cute 2D game sprite for a children's educational tower-defense game. Chibi cartoon style, flat vector illustration with soft cel shading, thick rounded dark-brown outlines, bright saturated colors, friendly and playful mood for elementary school kids. Single object only, centered, filling about 80% of the frame, isolated on a plain pure white background, no ground shadow, no text, no letters, no logo, no watermark, no border, square 1:1 image.
```

### AVOID (프롬프트 맨 끝에 공통으로 붙이기)

```
Avoid: realistic or painterly style, scary or violent details, blood, sharp teeth, extra objects, background scenery, text, gradients that blend into the background.
```

타워 공통 시점 문장: `View: three-quarter front view seen slightly from above (like a top-down strategy game at a 30-degree angle), standing on a small round stone platform.`
몬스터 공통 시점 문장: `View: side view facing to the right, full body visible, mid-walk (or mid-hover) pose.`

## 3. 배경 제거·정리 (Claude Code 태스크: `scripts/prepare_assets.py`)

- 입력: `assets/raw/*.png`(Gemini 원본, 흰 배경) → 출력: `frontend/public/assets/...`
- 처리: `rembg`(알파 매팅 켜기)로 배경 제거 → 투명 여백 트림 → 정사각 패딩 → 표의 크기로 리사이즈 → PNG-32 저장 → `pngquant`로 용량 줄이기(선택)
- 흰 테두리(halo)가 남으면 `rembg`의 `alpha_matting_foreground_threshold`를 올리거나 1px 침식(erode)
- 이미지 총합 3MB 이하 목표

---

## 4. 타워 프롬프트 (5장)

### 4-1. `tower_onsen.png` — 온천 타워 (온양온천 · 감속 + 작은 범위 피해)
```
[STYLE] A small Korean hot-spring bath tower: a round stone pool filled with glowing turquoise water, soft white steam swirls rising up, covered by a tiny traditional Korean tiled pavilion roof (giwa roof with gently curved edges) held up by four wooden posts, a small wooden bucket next to the pool. Colors: warm wood brown, grey stone, turquoise blue, white steam. [타워 시점 문장] [AVOID]
```

### 4-2. `tower_piri.png` — 피리 타워 (맹사성 · 직선 관통 소리 파동)
```
[STYLE] A tall bamboo Korean flute (piri) standing upright like a totem on a round stone pedestal, wrapped with a red silk cord, decorated with golden ginkgo leaves at the base and a tiny cute black ox figurine sitting beside it, three rounded musical notes floating upward. Colors: bamboo tan, gold, deep green, black ox. [타워 시점 문장] [AVOID]
```

### 4-3. `tower_geobukseon.png` — 거북선 타워 (이순신 · 단일 강타 대포)
```
[STYLE] A small chibi Korean turtle ship (geobukseon): a chunky wooden hull, a rounded spiked turtle-shell roof, a friendly dragon head at the front with a small round cannon muzzle in its mouth, three tiny cannon ports on the side, a small striped flag on top, sitting in a shallow round pool of blue water on a stone platform. Colors: navy blue, wood brown, gold trim, sea green. [타워 시점 문장] [AVOID]
```

### 4-4. `tower_bell.png` — 종탑 타워 (공세리 성당 · 종소리 범위 피해)
```
[STYLE] A small gothic-style red-brick bell tower: tall narrow tower with a pointed grey slate spire, one arched window with colorful stained glass (blue, red, yellow), an open belfry at the top showing a shiny golden bell with three curved sound-wave lines, a tiny green tree on each side of the round stone platform. Colors: warm red brick, grey slate, gold, stained-glass jewel tones. [타워 시점 문장] [AVOID]
```

### 4-5. `tower_mansae.png` — 만세 망루 (선장 4·4 · 빠른 연사, 긴 사거리)
```
[STYLE] A small Korean village wooden watchtower (lookout tower) with a thatched straw roof, a large waving Korean flag (Taegeukgi: white flag with red-blue taegeuk circle and four black trigrams) on a pole at the very top, two round paper lanterns hanging under the roof, a short wooden ladder, on a round stone platform. Colors: straw yellow, wood brown, white flag with red, blue and black. [타워 시점 문장] [AVOID]
```

## 5. 몬스터 프롬프트 (6장) — '망각의 괴물'

### 5-1. `enemy_slime.png` — 먹구름 슬라임 (기본)
```
[STYLE] A round storm-cloud slime monster: a bouncy jelly body shaped like a puffy dark grey-blue cloud, two big sleepy droopy eyes, a small yawning mouth, one tiny yellow lightning-bolt sparkle on top of its head, translucent jelly highlights. Colors: dark grey-blue, pale blue highlights, yellow spark. [몬스터 시점 문장] [AVOID]
```

### 5-2. `enemy_bat.png` — 안개 박쥐 (빠름)
```
[STYLE] A small fog bat monster: a round pale lavender body, big rounded ears, wide spread wings with soft rounded tips, dizzy swirl eyes, a tiny open mouth, small wisps of grey mist trailing behind it. Colors: lavender, soft purple, light grey mist. [몬스터 시점 문장, hovering pose] [AVOID]
```

### 5-3. `enemy_golem.png` — 바위 골렘 (단단함, 느림)
```
[STYLE] A chunky moss-covered stone golem: a big rounded grey boulder body, short thick arms and stubby legs, soft glowing pale-blue crack lines on its chest, a tuft of green grass and a tiny flower on its head, a calm dopey smile, heavy slow walking pose. Colors: stone grey, moss green, pale blue glow. [몬스터 시점 문장] [AVOID]
```

### 5-4. `enemy_ghost.png` — 잉크 유령 (반투명)
```
[STYLE] A small ink-blot ghost: a round black ink body with soft dripping wavy edges at the bottom instead of legs, two white oval eyes, a tiny surprised mouth, holding a small Korean ink brush, a faint purple glow around it. Colors: ink black, white eyes, soft purple glow. [몬스터 시점 문장, floating pose] [AVOID]
```

### 5-5. `enemy_dokkaebi.png` — 지우개 도깨비 (무리)
```
[STYLE] A tiny mischievous Korean dokkaebi goblin: short round body, one small blunt horn, wild spiky orange hair, a cheeky grin with one small tooth, orange-brown skin, wearing a simple brown vest, carrying a big pink-and-blue school eraser over its shoulder like a club, running pose. Colors: orange-brown, pink and blue eraser. [몬스터 시점 문장] [AVOID]
```

### 5-6. `enemy_golden_slime.png` — 황금 슬라임 (보너스)
```
[STYLE] A shiny golden bonus slime: a round glossy gold jelly body with bright white star sparkles, a small gold coin embedded on top of its head, happy squinting eyes and a wide smile, bouncing pose. Colors: bright gold, yellow, white sparkles. [몬스터 시점 문장] [AVOID]
```

## 6. 보스 프롬프트 (2장, 필수)

### 6-1. `boss_mid.png` — 중간보스 먹구름 대왕 슬라임
```
[STYLE] A big storm-cloud king slime boss: a large puffy dark grey-blue jelly cloud body about three times bigger and rounder than a normal slime, wearing a small golden crown, thick bushy eyebrows and a grumpy-but-cute pouting face, two yellow lightning bolts sparking from its sides, three tiny storm clouds orbiting around it, glossy jelly highlights. Colors: dark grey-blue, gold crown, yellow lightning. [몬스터 시점 문장] [AVOID]
```

### 6-2. `boss_final.png` — 최종보스 망각의 용
```
[STYLE] A big friendly-looking smoke dragon boss called the Dragon of Forgetting: a long rounded dark purple dragon body made of soft smoke, short rounded horns, a bossy but cute face with glowing pale yellow eyes and a small smirk, no sharp teeth, small rounded wings, a tiny hourglass hanging on a cord around its neck, wisps of grey smoke and a few faded torn paper pieces swirling around it. Colors: deep purple, grey smoke, pale yellow glow, cream paper. [몬스터 시점 문장, coiled flying pose] [AVOID]
```

## 7. 선택 프롬프트 — 스테이지별 중간보스 변형 (5장)

### `boss_mid_s1.png` — 온천 김 두꺼비 (1단계 온양온천)
```
[STYLE] A big steam toad boss: a large round teal toad with puffs of white steam rising from its back, a small folded white towel resting on its head, half-closed relaxed eyes and a grumpy pout, glossy wet skin. Colors: teal, cream belly, white steam. [몬스터 시점 문장] [AVOID]
```

### `boss_mid_s2.png` — 먹물 까마귀 (2단계 맹사성)
```
[STYLE] A big ink crow boss: a large round black crow with feathers dripping like wet ink, holding a crumpled old paper scroll in its beak, a mischievous narrowed-eye expression, a few ink droplets falling. Colors: ink black, dark blue sheen, cream scroll. [몬스터 시점 문장, hopping pose] [AVOID]
```

### `boss_mid_s3.png` — 파도 문어 (3단계 이순신)
```
[STYLE] A big wave octopus boss: a large indigo-blue octopus with wave-pattern stripes on its head, eight curly tentacles, wearing a tiny white sailor cap, foam bubbles around it, a cheeky grin. Colors: indigo, sea blue, white foam. [몬스터 시점 문장, floating pose] [AVOID]
```

### `boss_mid_s4.png` — 벽돌 골렘 (4단계 공세리 성당)
```
[STYLE] A big red-brick golem boss: a large chunky creature built from rounded red bricks, small rounded stone wings, patches of green moss, a cracked wide grin, tiny green vines hanging from its arms. Colors: warm red brick, grey mortar, moss green. [몬스터 시점 문장] [AVOID]
```

### `boss_mid_s5.png` — 안개 여우 (5단계 선장 4·4)
```
[STYLE] A big fog fox boss: a large pale grey fox made of soft fog with three fluffy misty tails, glowing warm lantern-orange eyes, a sly friendly grin, wisps of mist trailing from its paws. Colors: pale grey, white, lantern orange. [몬스터 시점 문장, prowling pose] [AVOID]
```

## 8. 선택 프롬프트 — 성(기지)

### `base_castle.png` — 아산 역사 기록의 성
```
[STYLE] A small Korean fortress gate as a game base: a short grey stone wall with a wooden double door, a traditional Korean tiled pavilion roof on top, a big glowing golden open book floating above the roof (representing history records), two small red lanterns beside the door. View: front view, slightly from above. Colors: grey stone, wood brown, dark tiled roof, gold glow. [AVOID]
```

## 9. 검수 체크리스트 (선생님용)

- [ ] 13장 모두 선 굵기·채도·2~3등신 비율이 비슷한가
- [ ] 몬스터는 모두 **오른쪽**을 보고 있는가 (왼쪽이면 코드로 뒤집으니 최소한 방향이 통일되어야 함)
- [ ] 타워는 모두 둥근 돌 받침 위에 있는가
- [ ] 글자·로고·그림자·배경이 없는가
- [ ] 무섭거나 폭력적인 요소가 없는가 (초등 대상)
- [ ] 배경 제거 후 흰 테두리가 남지 않는가
