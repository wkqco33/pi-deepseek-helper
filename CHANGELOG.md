# Changelog

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/), 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## [Unreleased]

## [0.1.1] - 2026-11-20

### Changed

- 첫 CI 배포(Trusted Publishing)로 전환한 릴리스. 기능 변경은 없고, `publish.yml`에 `registry-url`을 추가해 OIDC 교환과 provenance 서명이 동작하도록 했습니다.
- `0.1.0`은 최초 배포 제약(npm은 패키지가 존재해야 Trusted Publisher 설정 가능) 때문에 수동 배포되어 provenance가 없습니다. 이 버전부터 배포 출처 증명이 첨부됩니다.

## [0.1.0] - 2026-11-20

### Added

- `gate`: `edit`/`write` 후 검증 명령 없이 실행이 끝나려 하면 1턴을 이어 붙여 검증을 요구하는 완료 게이트. 실행당 최대 1회, Esc 중단 시 미발동, 프로젝트 게이트 명령 자동 제안(`package.json` → `Cargo.toml` → `Taskfile.yml` → `pyproject.toml` → `Makefile` → `go.mod` → `test_*.py` 순).
- `distill`: `bash`/`grep`/`find`/`ls`의 긴 도구 출력을 head 25줄 + tail 20줄 + 실패 신호 줄로 축약하고, `structuredContent`도 같은 규칙으로 줄여 보존. `read` 결과는 대상에서 제외.
- `router`: `ollama/flash-boost` 가상 모델. 한 사용자 턴에서 실패 도구 호출이 임계값 이상이고 마지막 결과도 실패면 상위 모델로 승격, 마지막 호출이 성공하면 복귀, 프로바이더 재시도는 즉시 승격.
- `scripts/eval.ts`: 과제별 fixture 격리 실행, 확장 on/off A/B, 게이트 판정, 턴/토큰/시간/확장 이벤트 집계, baseline 대비 delta Markdown 리포트.
- 과제 5종: `fix-off-by-one`, `add-keyword-arg`, `dedupe-refactor`, `edge-cases`, `noisy-repro`.
- `/flash-boost` 상태 명령과 `PI_FLASH_*` 환경 변수.
- `scripts/verify-pack.mjs`: tarball에 런타임 파일이 모두 들어 있고 `test/`·`.work/`가 빠졌는지, `pi` 매니페스트 경로가 실제로 포함됐는지 검사.
- GitHub Actions: Node 20/22/24 테스트 CI와 `v*` 태그 Trusted Publishing 배포 워크플로.

### Changed

- 패키지 이름을 `pi-deepseek-helper`로 정하고 npm 배포 메타데이터(저장소, `files`, `publishConfig`, `engines`)를 추가했습니다.
- 개발 도구를 prettier 기준으로 정렬하고 `npm run check`(테스트·타입·포맷·tarball)를 릴리스 게이트로 사용합니다.

### Fixed

- `eval` 실행기가 자식 `pi`에 닫히지 않는 stdin 파이프를 물려주어 모든 시도가 무기한 대기하던 문제. 이제 `stdin: ignore`로 실행합니다.
- 라우터의 실패 카운트가 assistant 메시지에서 끊겨 두 번 연속 실패를 감지하지 못하던 문제. 현재 사용자 턴 기준으로 세도록 수정했습니다.

### Removed

- 샘플링 파라미터 튜닝은 측정에서 개선이 확인되지 않아 적용하지 않았습니다(`models.json` 원복).
