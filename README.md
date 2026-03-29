# HogumaView

호구마뷰는 Tauri + TypeScript + Rust로 만든 Windows 이미지 뷰어입니다.

## 개발 환경

- Node.js 20+
- Rust stable
- Tauri CLI 2.x
- Windows 빌드 환경

## 시작하기

```bash
npm install
npm run tauri dev
```

## 배포 빌드

```bash
npm run tauri build
```

기본 번들 설정은 `nsis` 설치형 패키지입니다.

## 프로젝트 구조

- `src/`: 프런트엔드 UI
- `src-tauri/`: Rust 백엔드와 Tauri 설정
- `public/`: 정적 리소스
- `scripts/`: 보조 스크립트

## 라이선스

이 프로젝트는 [MIT License](./LICENSE)를 따릅니다.
