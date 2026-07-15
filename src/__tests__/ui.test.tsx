// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import App from "../App";

// Mock WebGLRenderer to prevent crashes in headless JSDOM environment
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  
  class MockWebGLRenderer {
    domElement = document.createElement("canvas");
    shadowMap = { enabled: true, type: {} };
    setSize() {}
    setPixelRatio() {}
    render() {}
    dispose() {}
    setScissorTest() {}
    setScissor() {}
    setViewport() {}
  }

  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

// Mock OrbitControls
vi.mock("three/examples/jsm/controls/OrbitControls.js", () => {
  class MockOrbitControls {
    update() {}
    dispose() {}
    enableDamping = false;
    dampingFactor = 0;
    maxPolarAngle = 0;
    minDistance = 0;
    maxDistance = 0;
    target = { set() {} };
  }
  return {
    OrbitControls: MockOrbitControls,
  };
});

describe("Causal Civilization Engine - UI mounting check", () => {
  it("should mount App component and initial state without crashing", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const root = createRoot(container);
    root.render(<App />);

    // Wait for the simulation and mounting to finish (it runs to Year 400 initially)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify App has rendered title
    expect(document.body.innerHTML).toContain("CAUSAL CIVILIZATION ENGINE");
    
    // Verify timeline controls are visible
    expect(document.body.innerHTML).toContain("Temporal Frame");
    expect(document.body.innerHTML).toContain("Year");

    root.unmount();
    document.body.removeChild(container);
  }, 60000);
});
