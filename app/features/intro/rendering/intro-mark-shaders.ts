import { AUDITORIUM, AUDITORIUM_MATERIAL } from "../core/intro-auditorium";
import {
  ARRIVAL_ENTRY,
  JOURNEY,
  ROAD_MATERIALIZATION,
  SCENERY_REVEAL,
} from "../core/intro-geometry";

export const VERTEX = `
attribute vec3 position;
attribute vec3 normal;
attribute float material;
attribute float roadAcross;
uniform mat4 camera;
uniform vec2 viewport;
uniform mediump float fill;
uniform float travel;
varying mediump float light;
varying mediump float road;
varying mediump vec2 roadUv;
varying mediump float haze;
varying mediump vec3 surfaceNormal;
varying mediump vec3 viewDirection;
varying mediump float altitude;
varying mediump vec2 facadeUv;
varying mediump vec3 portalPosition;
void main() {
  vec3 world = position;
  // Destination geometry stays installed; only the portal aperture opens.
  // 室内几何保持安装位置，只展开传送门开口。
  portalPosition = (position - vec3(${JOURNEY.roadX.toFixed(1)},
    ${(JOURNEY.floorY - ARRIVAL_ENTRY.height / 2).toFixed(1)},
    ${ARRIVAL_ENTRY.front.toFixed(1)})) / ${ARRIVAL_ENTRY.width.toFixed(1)};
  if (material < 0.5) world.z *= fill;
  else world.z += travel;
  vec4 view = camera * vec4(world, 1.0);
  float distance = ${JOURNEY.perspective.toFixed(1)} - view.z;
  gl_Position = vec4(2.0 * ${JOURNEY.perspective.toFixed(1)} * view.x / viewport.x,
    -2.0 * ${JOURNEY.perspective.toFixed(1)} * view.y / viewport.y,
    ${((JOURNEY.far + JOURNEY.near) / (JOURNEY.far - JOURNEY.near)).toFixed(12)} * distance - ${((2 * JOURNEY.far * JOURNEY.near) / (JOURNEY.far - JOURNEY.near)).toFixed(12)}, distance);
  light = material < 0.5
    ? (abs(normal.z) > 0.99 ? 1.0 : 0.65 + 0.27 * abs(normal.y) + 0.08 * abs(normal.x))
    : (material < 1.5 ? 0.75 + 0.25 * max(0.0, -normal.y) : 0.70 + 0.16 * abs(normal.y) + 0.14 * abs(normal.x));
  road = material;
  haze = smoothstep(1800.0, 11000.0, distance);
  surfaceNormal = mat3(camera) * normal;
  viewDirection = normalize(vec3(-view.xy, distance));
  altitude = max(0.0, (${(JOURNEY.floorY + JOURNEY.cityDrop).toFixed(1)} - position.y) / 1200.0);
  facadeUv = vec2((position.x + position.z * 0.43) / 500.0, position.y / 320.0);
  roadUv = vec2(roadAcross,
    (${JOURNEY.roadStart.toFixed(1)} - position.z) / ${(JOURNEY.depth + JOURNEY.roadStart).toFixed(1)});
}`;

export const FRAGMENT = `
precision mediump float;
uniform vec3 bodyColor;
uniform vec3 roadColor;
uniform vec3 signalColor;
uniform vec3 secondaryColor;
uniform float passage;
uniform vec3 skylineColor;
uniform vec3 sceneColor;
uniform float skylineVisibility;
uniform float arrivalVisibility;
uniform mediump float fill;
uniform mediump float reach;
uniform mediump vec3 portalEye;
uniform mediump float entryGrowth;
varying mediump float light;
varying mediump float road;
varying mediump vec2 roadUv;
varying mediump float haze;
varying mediump vec3 surfaceNormal;
varying mediump vec3 viewDirection;
varying mediump float altitude;
varying mediump vec2 facadeUv;
varying mediump vec3 portalPosition;
float grain(vec2 coordinate) {
  vec3 p = fract(vec3(coordinate.xyx) * 0.1031);
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
vec3 matteNeutral(vec3 tokenColor) {
  float value = (tokenColor.r + tokenColor.g + tokenColor.b) / 3.0;
  return mix(vec3(value), tokenColor, 0.1);
}
void main() {
  vec3 color = bodyColor * light;
  float alpha = fill;
  float portalRim = 0.0;
  if (road > 8.5) {
    if (portalEye.z > 0.0) {
      if (entryGrowth <= 0.0 || portalPosition.z > 0.0) discard;
      float depth = portalEye.z - portalPosition.z;
      vec2 ray = portalPosition.xy * portalEye.z - portalEye.xy * portalPosition.z;
      vec2 bounds = vec2(0.5, ${(ARRIVAL_ENTRY.height / ARRIVAL_ENTRY.width / 2).toFixed(6)}) * entryGrowth;
      vec2 edge = bounds * depth - abs(ray);
      if (min(edge.x, edge.y) < 0.0) discard;
      portalRim = 1.0 - smoothstep(0.0, 0.012, min(edge.x, edge.y) / depth);
    }
    if (road > 13.5 && road < 14.5 && roadUv.y > reach) discard;
    alpha = 1.0;
    vec3 n = normalize(surfaceNormal);
    vec3 neutralScene = matteNeutral(sceneColor);
    vec3 neutralBody = matteNeutral(bodyColor);
    vec3 neutralDark = min(neutralScene, neutralBody);
    vec3 neutralLight = max(neutralScene, neutralBody);
    // Preserve canvas and accent hues instead of mixing text gray into the architecture.
    // 结构底色保留画布与强调色的色相，不再混入文字灰色。
    vec3 accent = mix(signalColor, secondaryColor, 0.28);
    float dark = 1.0 - smoothstep(0.12, 0.55, dot(sceneColor, vec3(0.2126, 0.7152, 0.0722)));
    vec3 graphite = mix(matteNeutral(sceneColor), matteNeutral(roadColor), 0.32);
    vec3 base = mix(mix(sceneColor, roadColor, 0.65), accent, 0.1);
    base = mix(base, graphite, dark * 0.96);
    float diffuse = 0.5 + 0.45 * max(0.0, dot(n, normalize(vec3(-0.3, -0.8, 0.55)))) + 0.12 * abs(n.x);
    float detail = 1.0 - smoothstep(0.12, 0.72, haze);
    // Recover room coordinates from the existing scene-anchored UVs.
    // 从现有场景坐标 UV 还原室内坐标。
    float roomAlong = (roadUv.y - ${((JOURNEY.roadStart - AUDITORIUM.entrance) / (JOURNEY.depth + JOURNEY.roadStart)).toFixed(6)}) / ${((AUDITORIUM.entrance - AUDITORIUM.stageFront) / (JOURNEY.depth + JOURNEY.roadStart)).toFixed(6)};
    float roomAcross = facadeUv.x * 0.5 + roadUv.y * ${((JOURNEY.depth + JOURNEY.roadStart) * 0.00043).toFixed(6)} + ${(-JOURNEY.roadStart * 0.00043 - JOURNEY.roadX / 1000).toFixed(6)};
    float upward = max(0.0, -n.y);
    float stagePool = exp(-roomAcross * roomAcross * 0.65) * smoothstep(0.18, 1.15, roomAlong);
    float finish = grain(floor(vec2(facadeUv.x * 145.0, roadUv.y * 2600.0))) - 0.5;
    float roughness = grain(floor(vec2(facadeUv.x * 13.0, roadUv.y * 220.0))) - 0.5;
    color = base * (0.82 + diffuse * 0.18 - upward * 0.02 + stagePool * 0.1);
    color *= 1.0 + finish * 0.022 * detail + roughness * 0.018;
    float corner = pow(clamp(abs(roomAcross) / ${(AUDITORIUM.halfWidth / 1000).toFixed(3)}, 0.0, 1.0), 6.0);
    color *= 1.0 - corner * (0.06 + upward * 0.12);
    color = mix(color, mix(base, signalColor, 0.6), stagePool * max(0.0, n.z) * mix(0.42, 0.035, dark));
    if (abs(road - ${AUDITORIUM_MATERIAL.seat.toFixed(1)}) < 0.1) {
      // Upholstery absorbs light; accent tint stays below the neutral fabric response.
      // 布面吸收光线，强调色染色保持弱于中性织物响应。
      vec3 fabric = mix(base, neutralDark, 0.28);
      fabric = mix(fabric, signalColor, mix(0.06, 0.008, dark));
      float weave = grain(floor(facadeUv * vec2(240.0, 160.0))) - 0.5;
      color = fabric * (diffuse - 0.035 + weave * 0.035 * detail);
    } else if (abs(road - ${AUDITORIUM_MATERIAL.light.toFixed(1)}) < 0.1 || road > 17.5) {
      vec3 diffuser = mix(base, neutralLight, 0.55);
      color = mix(diffuser, mix(signalColor, secondaryColor, 0.2), 0.7);
    } else if (abs(road - ${AUDITORIUM_MATERIAL.acoustic.toFixed(1)}) < 0.1) {
      vec3 panel = mix(base, neutralDark, 0.14);
      color = panel * (diffuse + finish * 0.035 * detail);
    } else if (abs(road - ${AUDITORIUM_MATERIAL.alloy.toFixed(1)}) < 0.1 || road > 14.5) {
      vec3 metal = mix(base, signalColor, mix(0.18, 0.012, dark));
      vec3 lamp = normalize(vec3(-0.3, -0.8, 0.55));
      float specular = pow(max(0.0, dot(n, normalize(lamp + normalize(viewDirection)))), 32.0);
      color = metal * (0.82 + 0.18 * max(0.0, dot(n, lamp))) + neutralLight * specular * 0.28;
      color = mix(color, mix(base, signalColor, 0.6), stagePool * max(0.0, n.z) * mix(0.32, 0.025, dark));
    } else {
      // A broad, low-amplitude stage reflection reads as honed flooring, not glass.
      // 宽缓且低幅的舞台反射表现细磨地面，而非玻璃。
      float grazing = 1.0 - abs(dot(n, normalize(viewDirection)));
      float reflection = upward * stagePool * (0.035 + grazing * 0.065);
      color = mix(color, mix(neutralLight, signalColor, 0.08), reflection);
      float rim = pow(1.0 - abs(dot(n, normalize(viewDirection))), 3.0);
      color += neutralLight * rim * 0.035;
    }
    color = mix(color, mix(signalColor, secondaryColor, 0.2), portalRim * 0.65);
  } else if (road > 6.5 && road < 7.5) {
    alpha = arrivalVisibility * 0.65;
    if (alpha < 0.001) discard;
    color = mix(signalColor, secondaryColor, 0.28);
  } else if (road > 4.5) {
    alpha = skylineVisibility * smoothstep(0.0, 0.22, altitude) * (0.22 - haze * 0.15);
    color = mix(skylineColor * (0.86 + light * 0.14), sceneColor, haze * 0.38);
    float bay = abs(fract(facadeUv.x) - 0.5);
    float mullion = smoothstep(0.46, 0.495, bay);
    float floors = smoothstep(0.44, 0.49, abs(fract(facadeUv.y) - 0.5));
    float reflectionBand = pow(max(0.0, 1.0 - abs(fract(facadeUv.x * 0.18 + altitude * 0.08) - 0.42) * 2.2), 5.0);
    float grazing = pow(1.0 - abs(dot(normalize(surfaceNormal), normalize(viewDirection))), 3.0);
    float detail = 1.0 - smoothstep(0.2, 0.85, haze);
    color = mix(color * (1.0 - (mullion * 0.18 + floors * 0.09) * detail), mix(sceneColor, secondaryColor, 0.2), reflectionBand * 0.2 + grazing * 0.12);
    if (road > 7.5) {
      alpha *= 1.5;
      color = mix(color, sceneColor, 0.22);
    }
    float emission = road > 5.5 && road < 6.5 ? detail : 0.0;
    color = mix(color, mix(signalColor, secondaryColor, 0.35), emission * 0.8);
    alpha += skylineVisibility * emission * (0.32 - haze * 0.18);
  } else if (road > 1.5) {
    alpha = smoothstep(roadUv.y + ${SCENERY_REVEAL.start.toFixed(3)}, roadUv.y + ${(SCENERY_REVEAL.start + SCENERY_REVEAL.span).toFixed(3)}, reach) * (1.0 - haze * 0.65);
    if (alpha < 0.001) discard;
    vec3 n = normalize(surfaceNormal);
    vec3 lighting = normalize(vec3(-0.4, -0.7, 0.6));
    float diffuse = 0.66 + 0.24 * abs(dot(n, lighting));
    float highlight = pow(max(0.0, dot(n, normalize(lighting + normalize(viewDirection)))), 28.0);
    color = mix(roadColor, bodyColor, 0.12) * diffuse + bodyColor * highlight * 0.24;
    if (road > 3.5) {
      float fresnel = pow(1.0 - abs(dot(n, normalize(viewDirection))), 3.0);
      alpha *= 0.16 + fresnel * 0.2;
      float cells = abs(fract(roadUv.y * 56.0) - 0.5);
      float grid = smoothstep(0.46, 0.49, cells);
      alpha += grid * 0.1 * (1.0 - haze);
      color = mix(roadColor, signalColor, 0.38 + fresnel * 0.25 + grid * 0.18);
    } else if (road > 2.5) {
      float nodes = pow(max(0.0, sin(roadUv.y * 150.0)), 12.0);
      color = mix(signalColor, secondaryColor, nodes * 0.35) * (1.0 + nodes * 0.3);
    }
  } else if (road > 0.5) {
    float edge = 1.0 - smoothstep(0.0, 0.006, min(roadUv.x, 1.0 - roadUv.x));
    float across = min(roadUv.x, 1.0 - roadUv.x);
    float shoulder = 1.0 - smoothstep(0.014, 0.04, across);
    float inlay = smoothstep(0.048, 0.052, across) * (1.0 - smoothstep(0.055, 0.059, across));
    float reflection = pow(max(0.0, 1.0 - abs(roadUv.x - 0.4) * 1.8), 6.0) * 0.07;
    color = mix(roadColor * light * (1.0 - shoulder * 0.14), bodyColor, reflection + edge * 0.18 + inlay * 0.14);
    float textureFade = 1.0 - haze;
    float aggregate = grain(floor(roadUv * vec2(460.0, 1850.0)));
    float roughness = grain(floor(roadUv * vec2(22.0, 160.0)));
    float seam = smoothstep(0.47, 0.495, abs(fract(roadUv.y * 72.0) - 0.5));
    float longitudinalJoint = 1.0 - smoothstep(0.001, 0.003, abs(roadUv.x - 0.5));
    color *= 1.0 + (aggregate - 0.5) * 0.065 * textureFade + (roughness - 0.5) * 0.035;
    color *= 1.0 - (seam * 0.08 + longitudinalJoint * 0.07) * textureFade;
    float grazingRoad = pow(1.0 - abs(dot(normalize(surfaceNormal), normalize(viewDirection))), 4.0);
    float edgeReflection = exp(-abs(across - 0.08) * 21.0) * (0.6 + roughness * 0.4);
    color = mix(color, mix(roadColor, signalColor, 0.35), grazingRoad * edgeReflection * 0.13);
    float guide = smoothstep(0.074, 0.078, across) * (1.0 - smoothstep(0.082, 0.086, across));
    float segment = smoothstep(0.10, 0.18, fract(roadUv.y * 18.0)) * (1.0 - smoothstep(0.78, 0.86, fract(roadUv.y * 18.0)));
    float pulse = pow(max(0.0, sin(roadUv.y * 42.0 - passage)), 8.0);
    float crossline = smoothstep(0.46, 0.49, abs(fract(roadUv.y * 9.0) - 0.5));
    float node = smoothstep(0.12, 0.13, across) * (1.0 - smoothstep(0.15, 0.16, across));
    vec3 guidance = mix(signalColor, secondaryColor, pulse * 0.65);
    float circuitry = inlay * 0.22 + guide * segment * (0.28 + pulse * 0.5 + arrivalVisibility * 0.3) + crossline * (0.025 + node * 0.2);
    color = mix(color, guidance, min(0.86, circuitry * 1.4));
    float solid = smoothstep(0.0, ${ROAD_MATERIALIZATION.reach.toFixed(3)}, reach);
    float distanceFromFront = (reach - roadUv.y) * ${(JOURNEY.depth + JOURNEY.roadStart).toFixed(1)};
    alpha = 0.94 * solid * smoothstep(0.0, ${ROAD_MATERIALIZATION.feather.toFixed(1)}, distanceFromFront);
    if (alpha < 0.001) discard;
  }
  gl_FragColor = vec4(color * alpha, alpha);
}
`;
