# A-Dos Alpha — 4인 파일 질문 테스트

공개 화면: https://aedos-xi.vercel.app/
보조 화면: https://dobbycantbefree.github.io/AEdos/

테스터 4명은 각자 기기에서 `tester1`부터 `tester4`까지 고유 계정으로 로그인합니다. **Projects → OYF2027 → Files**에서 TXT·MD·CSV 파일을 올리거나 **Add Note**로 메모를 작성하고 **Question**에서 자료에 질문할 수 있습니다. 일정·장소·예산처럼 원문에서 바로 찾을 수 있는 질문은 브라우저 문서 검색으로 처리하고, 아이디어·분석·제안처럼 해석이 필요한 질문만 Cloudflare Workers AI를 사용합니다. 파일은 인증된 서버를 통해 공유되며 Research, Creative, Global AI 등 다른 화면은 시연 모드입니다.

## 파일과 사용 한도

- TXT·MD·CSV만 업로드 및 본문 분석 가능. UTF-8 텍스트, 파일당 최대 1MB, 읽기 대상 본문은 최대 10만 자입니다.
- PDF·Word·PPTX·이미지는 현재 본문을 읽지 못하며, 공개 알파에서는 업로드를 거부합니다.
- 질문은 테스터별 하루 5회까지입니다. Cloudflare 무료 AI 사용량을 넘으면 답변이 멈추며 유료 서비스로 자동 전환하지 않습니다.
- 회사 기밀, 고객 자료, 개인정보를 올리지 말고 가상 자료로만 시험하세요.

## 구성과 보안

Vercel과 GitHub Pages의 `index.html`은 Supabase Edge Function `ados-api`와 통신합니다. Supabase의 비공개 Storage 버킷에 원본을, 접근 차단된 데이터베이스 테이블에 읽은 텍스트를 저장합니다. Edge Function은 4개 계정의 무작위 비밀번호와 서명된 12시간 세션을 검사합니다. 현재 프런트엔드는 Cloudflare Workers AI를 호출하지 않습니다. 비밀값은 브라우저나 이 저장소에 넣지 않습니다.

백엔드 코드는 `supabase/functions/ados-api/index.ts`, 적용한 스키마는 `supabase/migrations/20261120_create_ados_alpha.sql`에 있습니다. 실제 테스트용 계정 비밀번호는 저장소에 포함하지 않습니다.

## 로컬 시연

기존 `server.js`는 Node.js 20 이상에서 실행되는 별도의 로컬 공유 파일 시연입니다. Cloudflare AI를 사용하지 않고 원문 관련 문장만 검색합니다. 공개 GitHub Pages에서 쓰는 클라우드 백엔드와 구분해 주세요.

## 알려진 범위

Add Note는 서버에 저장됩니다. 이전 버전에서 만든 브라우저 로컬 Note는 작성한 기기·브라우저에서 다시 로그인할 때 서버로 옮겨집니다. 알파 서비스에서 아직 서버에 연결되지 않은 Question의 첨부·Sources 선택과 Files의 AI 제외·태그 변경은 오동작으로 보이지 않도록 비활성화되어 있습니다. 현재 Question은 CES 2027의 공유 자료 전체를 자동 검색합니다.
