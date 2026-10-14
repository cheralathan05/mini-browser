import { AgentPlanner } from "../backend/src/agents/agent.planner.js";
import { ToolRegistry } from "../backend/src/agents/tools/tool.registry.js";

async function runAutomationTests() {
  console.log("============================================================");
  console.log("🧪 TESTING NEXUS BROWSER AUTOMATION SUITE");
  console.log("============================================================");

  // 1. Test WhatsApp Web Automation Planner
  const waGoal = "Go to WhatsApp Web, send 'Hi' message to 229093 number";
  console.log(`\n1. Testing Planner with Goal: "${waGoal}"`);
  const waPlan = AgentPlanner.generateDeterministicPlan(waGoal);
  console.log(`   Generated Steps: ${waPlan.steps.length}`);
  waPlan.steps.forEach((s, idx) => {
    console.log(`   [Step ${idx + 1}] ${s.toolName} -> ${s.description}`);
    console.log(`      Input:`, JSON.stringify(s.input));
  });

  if (waPlan.steps.length !== 5) {
    throw new Error(`Expected 5 steps for WhatsApp plan, got ${waPlan.steps.length}`);
  }
  if (waPlan.steps[0].toolName !== "browser.whatsappSend") {
    throw new Error(`Expected step 1 tool to be browser.whatsappSend, got ${waPlan.steps[0].toolName}`);
  }
  if (waPlan.steps[0].input.phone !== "229093") {
    throw new Error(`Expected step 1 phone to be 229093, got ${waPlan.steps[0].input.phone}`);
  }

  // 2. Test Tool Registry for WhatsApp Tool Execution
  console.log("\n2. Testing ToolRegistry Execution for browser.whatsappSend");
  ToolRegistry.initialize();
  const waTool = ToolRegistry.get("browser.whatsappSend");
  if (!waTool) {
    throw new Error("browser.whatsappSend not registered in ToolRegistry");
  }

  const result = await ToolRegistry.execute("browser.whatsappSend", { phone: "229093", message: "Hi!" }, {
    userId: "test-user-id",
    workspaceId: "test-workspace-id",
    taskId: "test-task-id",
    runId: "test-run-id",
  });

  console.log("   Execution Result:", JSON.stringify(result, null, 2));
  if (!result.success) {
    throw new Error(`Tool execution failed: ${result.error}`);
  }

  // 3. Test Web Scraper Planner
  console.log("\n3. Testing Planner with Web Scraper Goal");
  const scrapePlan = AgentPlanner.generateDeterministicPlan("Scrape and extract prices from https://news.ycombinator.com");
  console.log(`   Scrape Steps: ${scrapePlan.steps.length}`);
  scrapePlan.steps.forEach((s, idx) => {
    console.log(`   [Step ${idx + 1}] ${s.toolName} -> ${s.description}`);
  });

  console.log("\n============================================================");
  console.log("✅ ALL BROWSER AUTOMATION SUITE TESTS PASSED 100%!");
  console.log("============================================================");
}

runAutomationTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
