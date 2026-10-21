// Interactive prompts for the deployment scripts. Hidden input is never echoed, never logged and never written to disk.
const readline = require("node:readline");

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const write = rl._writeToOutput;
      rl._writeToOutput = (s) => {
        if (s.includes(question)) write.call(rl, s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

module.exports = { ask };
