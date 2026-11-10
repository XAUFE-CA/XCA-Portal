import { type Color, MeshPhysicalMaterial, MeshStandardMaterial } from "three";
import { AUDITORIUM_MATERIAL as SURFACE } from "../core/intro-auditorium";
import type { AuditoriumPalette } from "./intro-scene-palette";

export const AUDITORIUM_SURFACE = `
vec3 roomAnchor = vec3(vIntroWorld.xy, vIntroAlong);
vec3 roomNormal = abs(normalize(vIntroNormal));
vec2 roomUv = roomNormal.y > 0.6 ? roomAnchor.xz : (roomNormal.x > 0.6 ? roomAnchor.zy : roomAnchor.xy);
float roomFootprint = max(length(dFdx(roomUv)), length(dFdy(roomUv)));
float roomGrain = introNoise(roomAnchor * 0.035);
if (introSelector == 10.0 || introSelector == 17.0) {
  float weaveScale = introSelector == 10.0 ? 1.8 : 1.1;
  float weaveFilter = 1.0 - smoothstep(0.7, 2.0, roomFootprint * weaveScale);
  vec2 yarn = sin(roomUv * weaveScale * 6.283185);
  float weave = yarn.x * yarn.y * weaveFilter;
  roomFinish = weave * 0.055 + (roomGrain - 0.5) * 0.09;
  roomRelief = weave * 0.065;
  diffuseColor.rgb *= 0.94 + roomFinish;
} else if (introSelector == 12.0) {
  float perforationFilter = 1.0 - smoothstep(1.2, 3.5, roomFootprint);
  vec2 cell = fract(roomUv / 9.0) - 0.5;
  float hole = (1.0 - smoothstep(0.11, 0.22, length(cell))) * perforationFilter;
  roomFinish = (roomGrain - 0.5) * 0.035 + hole * 0.2;
  roomRelief = -hole * 0.16;
  diffuseColor.rgb *= 1.0 - hole * 0.48 + (roomGrain - 0.5) * 0.025;
} else if (introSelector == 13.0) {
  float brushingFilter = 1.0 - smoothstep(0.4, 1.8, roomFootprint);
  float brushing = introNoise(vec3(roomUv.x * 0.025, roomUv.y * 2.8, 2.0));
  roomFinish = (brushing - 0.5) * brushingFilter * 0.10;
  roomRelief = roomFinish * 0.16;
  diffuseColor.rgb *= 1.0 + roomFinish * 0.18;
} else if (introSelector == 14.0 || introSelector == 21.0) {
  vec2 jointDistance = min(fract(roomUv / 600.0), 1.0 - fract(roomUv / 600.0)) * 600.0;
  float joint = 1.0 - smoothstep(0.8, 1.8 + roomFootprint, min(jointDistance.x, jointDistance.y));
  float stone = introNoise(roomAnchor * 0.012);
  roomFinish = (stone - 0.5) * 0.10 + joint * 0.15;
  roomRelief = (roomGrain - 0.5) * 0.035 - joint * 0.12;
  diffuseColor.rgb *= 0.95 + stone * 0.10 - joint * 0.20;
} else if (introSelector == 9.0 || introSelector == 19.0) {
  roomFinish = (roomGrain - 0.5) * 0.06;
  roomRelief = roomFinish * 0.08;
  diffuseColor.rgb *= 1.0 + roomFinish * 0.2;
}
`;

export const AUDITORIUM_ROUGHNESS = `
if (introSelector > 8.5) roughnessFactor = clamp(roughnessFactor + roomFinish, 0.07, 1.0);
`;

export const AUDITORIUM_EMISSION = `
if (introSelector == 20.0) {
  totalEmissiveRadiance *= smoothstep(0.7, 0.95, -normalize(vIntroNormal).y);
}
`;

export const AUDITORIUM_NORMAL = `
if (introSelector > 8.5 && roomRelief != 0.0) {
  vec3 roomDx = dFdx(-vViewPosition);
  vec3 roomDy = dFdy(-vViewPosition);
  vec3 roomRx = cross(roomDy, normal);
  vec3 roomRy = cross(normal, roomDx);
  float roomDet = dot(roomDx, roomRx) * faceDirection;
  vec3 roomGradient = sign(roomDet) * (dFdx(roomRelief) * roomRx + dFdy(roomRelief) * roomRy);
  normal = normalize(max(abs(roomDet), 1e-8) * normal - roomGradient);
}
`;

export function createAuditoriumMaterial(selector: number) {
  if (selector === SURFACE.seat)
    return new MeshPhysicalMaterial({
      roughness: 0.91,
      sheen: 0.48,
      sheenRoughness: 0.88,
      specularIntensity: 0.3,
    });
  if (selector === SURFACE.alloy)
    return new MeshPhysicalMaterial({
      roughness: 0.36,
      metalness: 0.78,
      anisotropy: 0.42,
      anisotropyRotation: Math.PI / 2,
    });
  if (selector === SURFACE.wallBand)
    return new MeshStandardMaterial({ roughness: 0.84, metalness: 0 });
  const roughness =
    selector === SURFACE.carpet
      ? 0.98
      : selector === SURFACE.ground || selector === SURFACE.connection
        ? 0.63
        : 0.76;
  return new MeshStandardMaterial({
    roughness,
    metalness: selector === SURFACE.acoustic ? 0.24 : selector === SURFACE.graphite ? 0.32 : 0.03,
  });
}

export function updateAuditoriumMaterial(
  material: MeshStandardMaterial,
  selector: number,
  room: AuditoriumPalette,
) {
  const finishes: Partial<Record<number, Color>> = {
    [SURFACE.structure]: room.structure,
    [SURFACE.gateway]: room.graphite,
    [SURFACE.seat]: room.fabric,
    [SURFACE.acoustic]: room.panel,
    [SURFACE.alloy]: room.alloy,
    [SURFACE.ground]: room.floor,
    [SURFACE.connection]: room.floor,
    [SURFACE.wallBand]: room.wallBand,
    [SURFACE.carpet]: room.carpet,
    [SURFACE.graphite]: room.graphite,
  };
  material.color.copy(finishes[selector] ?? room.structure);
  material.emissive.setRGB(0, 0, 0);
  material.envMapIntensity = 0;
  if (material instanceof MeshPhysicalMaterial && selector === SURFACE.seat)
    material.sheenColor.copy(room.fabric).lerp(room.fillLight, 0.18);
  if (
    selector === SURFACE.light ||
    selector === SURFACE.entryLight ||
    selector === SURFACE.ceilingLight
  ) {
    material.color.copy(selector === SURFACE.ceilingLight ? room.keyLight : room.accentLight);
    material.emissive.copy(material.color);
    material.emissiveIntensity =
      room.lightIntensity * (selector === SURFACE.ceilingLight ? 0.85 : 0.65);
  }
}
