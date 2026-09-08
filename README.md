# CPU Simulator — ITE131 · Unit II · Computer Architecture

An interactive fetch–decode–execute visualiser for lectures on CPU
organisation. Students type a short assembly program, then step through it one
phase at a time and watch the Control Unit, ALU, registers and data memory
light up as each instruction moves through the machine.

Everything runs in the browser — there is no backend and nothing to install for
students beyond opening the page.

## What it shows

| Region | What it represents |
| --- | --- |
| **PC / IR / ZF** | Program Counter, Instruction Register, Zero Flag |
| **Control Unit** | Fetches and decodes; drives jumps and `HALT` |
| **ALU** | Arithmetic and comparison |
| **Registers** | Four general-purpose registers, `R0`–`R3` |
| **Data Memory** | 16 cells, addresses `0`–`15` |
| **Execution trace** | Running commentary, one line per phase (last 200 kept) |

Highlight colours carry meaning: **amber** marks control-unit activity and
writes, **teal** marks the ALU and reads. The spotlight bar under the header
narrates the phase that just executed. Animations respect
`prefers-reduced-motion`.

## Running it

```bash
pnpm install
pnpm dev        # http://localhost:5173
```

Other scripts: `pnpm build` (typecheck + production bundle), `pnpm preview`
(serve the build), `pnpm lint`.

## Using the simulator

1. Type a program in the **Program** panel, or pick a preset chip
   (*Multiply & store*, *Add & compare*).
2. Press **Load program**. Operands are validated here — errors are reported
   with a source line number and nothing runs until they are fixed.
3. **Step** advances the machine by one *phase*. **Run** does the same
   automatically every 750 ms; **Pause** stops it. **Reset** clears registers,
   memory and flags but keeps the program loaded. **Edit program** returns to
   the editor.

Each instruction takes four Step presses, which is the point of the tool — the
fetch/decode/execute stepper on the left shows where you are:

```
fetch  →  decode  →  execute  →  (idle, ready for the next fetch)
```

Note that `PC` is displayed as a 1-based instruction number so it lines up with
the numbered program listing, and it is incremented during **fetch** — so
during decode and execute it already points at the *next* instruction, exactly
as in real hardware.

## Instruction set

Mnemonics are case-insensitive and operands are comma-separated. Comments start
with `#` or `//` and may follow an instruction on the same line. Blank and
comment-only lines are ignored.

| Instruction | Operands | Effect |
| --- | --- | --- |
| `LOADI Rd, imm` | register, integer | `Rd ← imm` |
| `LOAD Rd, addr` | register, address | `Rd ← Memory[addr]` |
| `STORE Rs, addr` | register, address | `Memory[addr] ← Rs` |
| `ADD Rd, Ra, Rb` | three registers | `Rd ← Ra + Rb` |
| `SUB Rd, Ra, Rb` | three registers | `Rd ← Ra − Rb` |
| `MUL Rd, Ra, Rb` | three registers | `Rd ← Ra × Rb` |
| `CMP Ra, Rb` | two registers | Zero flag ← `Ra == Rb` |
| `JMP target` | instruction index | Unconditional jump |
| `JZ target` | instruction index | Jump if the zero flag is set |
| `HALT` | — | Stop execution |

Operand rules, all enforced at load time:

- **register** — `R0`–`R3`, case-insensitive.
- **integer** — a whole number, optionally negative. `ADD` and friends take
  registers only, never a literal.
- **address** — `0`–`15`.
- **instruction index** — see below.

### Jump targets are zero-based instruction indices

This is the one thing worth calling out in class. A jump operand counts
*instructions from zero*, while the program listing and the trace display
instructions from one. So `JMP 2` lands on the instruction shown as **3** in
the listing.

Comments and blank lines are skipped before indices are assigned, so they never
shift a jump target — but they do shift the source line numbers used in error
messages. Jump targets outside the program are rejected when you load it.

### Worked example: a countdown loop

```
# Count down R0 from 3 to 0
LOADI R0, 3        # index 0
LOADI R1, 1        # index 1
CMP R0, R1         # index 2  ← loop top
SUB R0, R0, R1     # index 3
JZ 6               # index 4  → HALT once R0 has reached 0
JMP 2              # index 5  → back to CMP
HALT               # index 6
```

`CMP` runs *before* the subtraction, so the zero flag is set on the pass where
`R0` still equals 1; the following `SUB` brings it to 0 and `JZ` then exits.
Halts after 14 instructions with `R0 = 0`.

## Load-time validation

The assembler refuses a program and explains why, rather than letting it run
into undefined behaviour:

- unknown instruction
- wrong number of operands
- an operand that should be a register but is not `R0`–`R3`
- an operand that should be a number but is not
- a memory address outside `0`–`15`
- a jump target outside the program
- an empty program

## Project layout

```
index.html              Entry point
src/main.tsx            React root
src/CPUSimulator.tsx    Assembler, machine state, and the whole UI
src/index.css           Reset plus all component styling (.cs-* classes)
```

`CPUSimulator.tsx` is deliberately one file so it can be read top to bottom in
a lecture: instruction table → assembler → machine state and the phase
step function → rendering.

## Built with

React 19, TypeScript and Vite, with [lucide-react](https://lucide.dev) icons.
