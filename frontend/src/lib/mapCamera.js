// Camera translation changes presentation only; robot/grid coordinates stay intact.
export function followOffset(robot, geometry, scale, pitch = 60, cell = 56) {
  return {
    x: (geometry.width / 2 - geometry.left - (robot.x * pitch + cell / 2)) * scale,
    y: (geometry.height / 2 - geometry.top - (robot.y * pitch + cell / 2)) * scale,
  };
}
