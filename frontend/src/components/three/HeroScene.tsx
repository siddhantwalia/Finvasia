import { Canvas, useFrame } from "@react-three/fiber";
import { Float, OrbitControls } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useTheme } from "next-themes";

function PolicyShards({ count = 22 }: { count?: number }) {
  const group = useRef<THREE.Group>(null);
  const items = useMemo(
    () =>
      new Array(count).fill(0).map((_, i) => ({
        pos: [
          (Math.random() - 0.5) * 6,
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 4,
        ] as [number, number, number],
        rot: [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI] as [number, number, number],
        scale: 0.25 + Math.random() * 0.6,
        speed: 0.2 + Math.random() * 0.6,
        seed: i,
      })),
    [count]
  );

  useFrame((_, dt) => {
    if (!group.current) return;
    group.current.rotation.y += dt * 0.06;
    group.current.children.forEach((m, i) => {
      m.rotation.x += dt * items[i].speed * 0.3;
      m.rotation.z += dt * items[i].speed * 0.2;
    });
  });

  return (
    <group ref={group}>
      {items.map((it, i) => (
        <Float key={i} speed={1.2} rotationIntensity={0.2} floatIntensity={0.6}>
          <mesh position={it.pos} rotation={it.rot} scale={it.scale}>
            <boxGeometry args={[1, 1.4, 0.04]} />
            <meshStandardMaterial color="#9bd83a" emissive="#9bd83a" emissiveIntensity={0.05} metalness={0.2} roughness={0.6} transparent opacity={0.18} />
          </mesh>
        </Float>
      ))}
    </group>
  );
}

function CoreOrb() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.4;
  });
  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[1.05, 1]} />
      <meshStandardMaterial color="#cdfb5b" emissive="#cdfb5b" emissiveIntensity={0.6} wireframe />
    </mesh>
  );
}

export const HeroScene = () => {
  const { theme } = useTheme();
  const bg = theme === "dark" ? "transparent" : "transparent";
  return (
    <Canvas dpr={[1, 1.6]} camera={{ position: [0, 0, 5.2], fov: 50 }} style={{ background: bg }}>
      <ambientLight intensity={0.4} />
      <pointLight position={[4, 4, 4]} intensity={1.2} color="#9bd83a" />
      <pointLight position={[-4, -2, -2]} intensity={0.6} color="#39c2ff" />
      <CoreOrb />
      <PolicyShards />
      <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.6} />
    </Canvas>
  );
};
