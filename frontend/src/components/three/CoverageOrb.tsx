import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

function Ring({ pct, radius, color, speed = 0.3 }: { pct: number; radius: number; color: string; speed?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.z += dt * speed;
  });
  const thetaLength = Math.max(0.05, Math.min(1, pct)) * Math.PI * 2;
  return (
    <mesh ref={ref}>
      <ringGeometry args={[radius - 0.06, radius, 64, 1, 0, thetaLength]} />
      <meshBasicMaterial color={color} side={THREE.DoubleSide} transparent opacity={0.85} />
    </mesh>
  );
}

function Core({ pct }: { pct: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.y += dt * 0.3;
    ref.current.rotation.x += dt * 0.12;
  });
  const scale = 0.5 + pct * 0.4;
  return (
    <mesh ref={ref} scale={scale}>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial color="#cdfb5b" emissive="#cdfb5b" emissiveIntensity={0.8} wireframe />
    </mesh>
  );
}

export const CoverageOrb = ({ score = 0.72 }: { score?: number }) => {
  return (
    <Canvas dpr={[1, 1.6]} camera={{ position: [0, 0, 4.5], fov: 50 }} style={{ background: "transparent" }}>
      <ambientLight intensity={0.5} />
      <pointLight position={[3, 3, 3]} intensity={1} color="#9bd83a" />
      <Core pct={score} />
      <Ring pct={score} radius={1.7} color="#9bd83a" speed={0.25} />
      <Ring pct={Math.min(1, score + 0.1)} radius={2.0} color="#39c2ff" speed={-0.18} />
      <Ring pct={Math.max(0.1, score - 0.2)} radius={2.3} color="#9bd83a" speed={0.12} />
    </Canvas>
  );
};
