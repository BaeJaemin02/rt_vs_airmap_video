/*
 * 영상 목록 (매니페스트)
 * ------------------------------------------------------------
 * 영상을 추가하려면 mp4 파일을 index.html 과 같은 폴더(또는 하위 폴더)에 두고
 * 아래 videos 배열에 항목을 하나 추가하세요.
 *
 *   id        고유 식별자 (영문/숫자/하이픈)
 *   file      index.html 기준 상대 경로
 *   source    결과를 만든 방식. 같은 source 끼리 한 그룹으로 묶여 표시됩니다.
 *             ("RT" / "AirMap" 은 색상이 지정되어 있습니다)
 *   kind      결과 종류 (예: "전파 지도", "Ray 시각화")
 *   date      생성 날짜 (표시용)
 *   fps       프레임 번호 계산에 사용 (브라우저가 fps를 알려주지 않음)
 *   width, height, duration   메타데이터 로딩 전에 레이아웃을 잡기 위한 값 (초 단위)
 *
 * 화면 배치: 그룹은 groups 에 적힌 순서로, 그룹 안의 영상은 videos 에 적힌 순서로
 * 왼쪽부터 놓입니다. (RT 전파 지도를 RT 그룹의 오른쪽 끝에 두어 AirMap 전파 지도와 붙어 보이게 함)
 */
window.VIDEO_LIBRARY = {
  title: "전파 시뮬레이션 결과 · Ray Tracing vs AirMap",
  groups: [
    // rates: (선택) 2개 이상 적으면 그룹 머리에 배속 버튼 표시 (예: rates: [1, 16])
    // views: 그룹 머리에 '어떤 영상을 띄울지' 버튼을 표시. show 는 영상 id 목록, defaultView 는 처음 선택(0부터)
    {
      source: "RT", title: "Ray Tracing", desc: "Sionna RT · 광선 경로와 전파 지도",
      views: [
        { label: "전파 지도", show: ["rt-heatmap"] },
        { label: "Ray", show: ["rt-ray"] },
        { label: "둘 다", show: ["rt-ray", "rt-heatmap"] }
      ],
      defaultView: 0
    },
    { source: "AirMap", title: "AirMap", desc: "AirMap 예측 전파 지도" }
  ],
  videos: [
    {
      id: "rt-ray",
      file: "test_261126_rt_ray_movingman.mp4",
      source: "RT",
      kind: "Ray 시각화",
      date: "2026-11-26",
      fps: 25, width: 1300, height: 1040, duration: 297.36
    },
    {
      id: "rt-heatmap",
      file: "test_261126_rt_movingman.mp4",
      source: "RT",
      kind: "전파 지도",
      date: "2026-11-26",
      fps: 25, width: 1300, height: 1040, duration: 297.36
    },
    {
      id: "airmap-heatmap",
      file: "test_261126_airmap_movingman.mp4",
      source: "AirMap",
      kind: "전파 지도",
      date: "2026-11-26",
      fps: 60, width: 1300, height: 1040, duration: 1.233
    }
  ]
};
