# pi-deepseek-helper

flash 계열 모델(특히 `deepseek-v4.1-flash:1017-cloud`)을 pi에서 쓸 때, 그 약점만 골라 보완하는 확장 3종과 측정용 eval 하네스입니다.

핵심 전제: **측정 없이 확장을 붙이지 않는다.** 모든 기능은 `evals/`의 고정 과제로 A/B 측정하고, 개선이 확인되지 않으면 넣지 않습니다.

## 구성

| 리소스 | 역할 |
| --- | --- |
| `extensions/gate.ts` | 편집 후 검증 없이 끝나려는 실행을 **한 번만** 되돌려 검증을 요구 |
| `extensions/distill.ts` | `bash`/`grep`/`find`/`ls`의 긴 출력을 head + tail + 실패로 보이는 줄로 축약 |
| `extensions/router.ts` | `ollama/flash-boost` 가상 모델. flash가 막혔을 때만 상위 모델로 승격 |
| `scripts/eval.ts` | 과제별 고정 fixture 복사 → `pi --mode json` 실행 → 게이트 판정 → 턴/토큰/시간 집계 |

## 설치

```bash
# npm에서 설치
pi install npm:pi-deepseek-helper

# 로컬 체크아웃으로 설치
pi install /path/to/pi-deepseek-helper

# 설정 변경 없이 한 번만 시험
pi -e /path/to/pi-deepseek-helper
```

`package.json`의 `pi.extensions`가 `extensions/index.ts` 하나만 가리키므로 하위 확장이 중복 등록되지 않습니다.

## 사용

기본값은 전부 켜짐입니다. 환경 변수로 개별 제어합니다.

| 변수 | 기본값 | 의미 |
| --- | --- | --- |
| `PI_FLASH_BOOST` | `1` | 전체 on/off |
| `PI_FLASH_GATE` | `1` | 완료 주장 게이트 |
| `PI_FLASH_DISTILL` | `1` | 도구 출력 축약 |
| `PI_FLASH_DISTILL_MAX_CHARS` | `6000` | 축약 임계값(문자) |
| `PI_FLASH_ROUTER` | `1` | 승격 라우터 등록 |
| `PI_FLASH_PRIMARY` | `deepseek-v4.1-flash:1017-cloud` | 라우터의 기본 모델 |
| `PI_FLASH_ESCALATE_MODELS` | `glm-5.3:cloud,kimi-k3.1-pro:cloud` | 승격 후보(순서대로 사용 가능한 것) |
| `PI_FLASH_ESCALATE_AFTER` | `2` | 한 사용자 턴에서 실패 도구 호출 임계값 |
| `PI_FLASH_LOG` | 없음 | 확장 이벤트 JSONL 경로(측정/디버깅용) |

- `/flash-boost` — 현재 활성 기능과 모델 표시
- `pi --model flash-boost` — 라우터 사용(기본은 flash, 막히면 승격)

### 게이트 동작

`edit`/`write`로 파일을 바꾼 뒤 검증 명령(`*_test`, `*_build`, `*_check`, `validation_bundle`, 또는 `pytest`/`cargo test`/`npm test` 같은 bash 명령)을 한 번도 실행하지 않았으면, 실행이 끝나기 직전에 1턴을 이어 붙여 검증을 요구합니다. 실행당 최대 1회, Esc로 중단한 실행에는 발동하지 않습니다.

### 축약 동작

임계값을 넘는 결과만 head 25줄 + tail 20줄 + 실패로 보이는 줄(최대 15)로 줄이고 `… [N lines / M chars omitted]`를 남깁니다. `read` 결과는 대상이 아닙니다(모델이 요청한 코드 전문을 자르면 오답 위험이 더 큼). `structuredContent`는 버리지 않고 같은 규칙으로 함께 줄입니다.

### 라우터 동작

- 한 사용자 턴 안에서 실패한 도구 호출이 임계값 이상이고 **마지막 결과도 실패**면 상위 모델로 승격합니다.
- 마지막 도구 호출이 성공하면 즉시 복귀합니다(성공한 작업을 비싼 모델로 반복하지 않음).
- `retry`(프로바이더 실패 후 재시도)는 즉시 승격합니다.
- 사용자 메시지가 오면 실패 카운트가 초기화됩니다.

## Eval 하네스

```bash
npm run eval -- --dry-run                     # 계획만 출력
npm run eval -- --label base  --repeat 3      # 확장 없이 측정
npm run eval -- --label boost --repeat 3 --ext . --baseline .work/base-*.json
```

- 과제: `evals/tasks/*.json`, fixture: `evals/fixtures/<id>/`
- 실행: 모든 발견 확장을 끄고(`--no-extensions`) `--ext`로 넘긴 것만 로드 → 설정 격리
- 격리: 과제마다 fixture를 `.work/<label>/run-N/<id>/`로 복사, 실패가 다음 시도에 남지 않음
- 판정: 실행 후 `gate.command`를 workdir에서 실행해 exit code로 판정
- 산출물: JSON(`tasks`, `overall`, `runs`) + Markdown 표, `.work/<label>/logs/*.jsonl`에 원본 이벤트

새 과제를 추가하려면 fixture 디렉터리와 `{ id, prompt, gate }` JSON 한 개만 있으면 됩니다.

## 측정 결과

`deepseek-v4.1-flash:1017-cloud`, thinking `medium`, 과제 5개 × 3회.

| 지표 | 확장 없음 | flash-boost | 변화 |
| --- | --- | --- | --- |
| 통과율 | 15/15 (100%) | 15/15 (100%) | 0pp |
| 평균 턴 | 5.9 | 5.9 | -0.1 |
| 평균 입력 토큰 | 8.7k | 2.2k | **-75%** |
| 벽시계 | 8.3s | 7.7s | -0.6s |
| distill 발동 | 0 | 4 | — |
| gate 발동 | 0 | 0 | — |

노이즈가 큰 과제만 따로(`noisy-repro` 3회): 입력 토큰 **35.6k → 2.9k (-92%)**, 벽시계 12.8s → 8.3s.

### 측정으로 기각한 것

- **샘플링 파라미터 튜닝**(`temperature 0.4 / top_p 0.9`, thinking level별 오버라이드): 통과율 변화 없음, 턴 +0.7 / 토큰 +0.6k로 오히려 나빠 보였고, 같은 설정 재측정에서도 ±0.3턴 변동이 확인되어 근거 없음 → `models.json` 원복.
- 참고: 같은 설정의 반복 측정 간 변동이 턴 ±1.2, 토큰 ±0.7k 수준입니다. 3회 미만 반복으로는 작은 효과를 판정할 수 없습니다.

### 아직 측정하지 못한 것

- **게이트의 통과율 기여**: 현재 fixture는 모두 flash가 스스로 검증해 100% 통과합니다. 게이트는 실제 저장소에서 "검증 없이 완료 선언"이 발생할 때만 효과가 있으므로, 합성 과제로는 증명되지 않았습니다(발동/1회 제한/Esc 미발동은 통합 테스트로 확인).
- **라우터의 비용 효과**: 과제가 쉬워 승격이 0회였습니다. 승격 경로 자체는 실패 도구 호출 2회 시나리오에서 확인했습니다.

## 개발

```bash
npm install
npm test          # 정책 단위 테스트 (node:test)
npm run typecheck # tsc --noEmit
npm run check     # test + typecheck + prettier + tarball 검사
```

정책 로직은 `src/*/policy.ts`의 순수 함수로 분리되어 있고, 확장 파일은 pi 이벤트와 그 함수를 잇는 얇은 어댑터입니다.

## 배포

`v*` 태그를 푸시하면 GitHub Actions가 npm Trusted Publishing(OIDC, provenance)으로 배포합니다.

```bash
npm run check                 # 로컬 릴리스 검사
npm pack --dry-run --json     # tarball 내용 확인
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/publish.yml`은 태그와 `package.json` 버전이 일치할 때만 배포합니다. npm 저장소가 아니라 GitHub 저장소(`wkqco33/pi-deepseek-helper`, 워크플로 `publish.yml`)에 Trusted Publisher가 등록되어 있어야 합니다.
