import { describe, expect, it } from "vitest";
import {
  audioExtension,
  buildMasteringFilter,
  buildMeasurementFilter,
  masterVoiceover,
  parseLoudnormJson,
  TARGET_LUFS,
} from "./mastering.js";

const LOUDNORM_LOG = `
[Parsed_loudnorm_0 @ 0x55] 
{
	"input_i" : "-26.41",
	"input_tp" : "-8.12",
	"input_lra" : "6.30",
	"input_thresh" : "-36.35",
	"output_i" : "-14.02",
	"output_tp" : "-1.50",
	"output_lra" : "5.20",
	"output_thresh" : "-24.12",
	"normalization_type" : "linear",
	"target_offset" : "0.02"
}
`;

describe("parseLoudnormJson", () => {
  it("reads the measurement block out of the log", () => {
    const measurement = parseLoudnormJson(LOUDNORM_LOG);

    expect(measurement).not.toBeNull();
    expect(measurement?.input_i).toBe("-26.41");
    expect(measurement?.input_tp).toBe("-8.12");
    expect(measurement?.input_thresh).toBe("-36.35");
    expect(measurement?.target_offset).toBe("0.02");
  });

  it("returns null when there is no block", () => {
    expect(parseLoudnormJson("ffmpeg: nothing to see")).toBeNull();
    expect(parseLoudnormJson("{ not json }")).toBeNull();
  });
});

describe("buildMasteringFilter", () => {
  it("uses the measurement for a transparent, linear gain", () => {
    const filter = buildMasteringFilter({
      input_i: "-26.41",
      input_tp: "-8.12",
      input_lra: "6.30",
      input_thresh: "-36.35",
      target_offset: "0.02",
    });

    expect(filter).toContain("highpass=f=70");
    expect(filter).toContain("deesser");
    expect(filter).toContain(`loudnorm=I=${TARGET_LUFS}`);
    expect(filter).toContain("measured_I=-26.41");
    expect(filter).toContain("linear=true");
    expect(filter).toContain("aresample=44100");
  });

  it("falls back to dynamic normalisation without a measurement", () => {
    const filter = buildMasteringFilter(null);

    expect(filter).toContain(`loudnorm=I=${TARGET_LUFS}`);
    expect(filter).not.toContain("measured_I=");
  });
});

describe("buildMeasurementFilter", () => {
  it("measures the cleaned signal, not the raw one", () => {
    const filter = buildMeasurementFilter();

    expect(filter).toContain("highpass=f=70");
    expect(filter).toContain("deesser");
    expect(filter).toContain(`loudnorm=I=${TARGET_LUFS}`);
    expect(filter).toContain("print_format=json");
  });
});

describe("audioExtension", () => {
  it("recognises the containers the providers return", () => {
    expect(audioExtension(Buffer.from("RIFF....WAVE"))).toBe("wav");
    expect(audioExtension(Buffer.from("ID3\u0004"))).toBe("mp3");
    expect(audioExtension(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBe("mp3");
    expect(audioExtension(Buffer.from("OggS...."))).toBe("ogg");
    expect(audioExtension(Buffer.from("fLaC...."))).toBe("flac");
    expect(audioExtension(Buffer.from("????"))).toBe("bin");
  });
});

describe("masterVoiceover", () => {
  it("returns the original audio when mastering fails", async () => {
    const original = Buffer.from("RIFF....WAVE");
    const master = await masterVoiceover(original, async () => {
      throw new Error("ffmpeg is not installed");
    });

    expect(master).toBe(original);
  });

  it("measures first, then applies the mastering chain to a WAV voice", async () => {
    const calls: string[][] = [];
    const { writeFileSync } = await import("node:fs");
    const master = await masterVoiceover(Buffer.from("RIFF....WAVE"), async (args) => {
      calls.push(args);
      writeFileSync(args[args.length - 1] ?? "", "MASTERED");
      return { stderr: calls.length === 1 ? LOUDNORM_LOG : "" };
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.join(" ")).toContain("print_format=json");
    expect(calls[0]?.join(" ")).toContain("highpass=f=70");
    expect(calls[1]?.join(" ")).toContain("measured_I=-26.41");
    // The aligner reads WAV, so a WAV voice must still be WAV here.
    expect(calls[1]?.join(" ")).toContain("pcm_s16le");
    expect(master.toString()).toBe("MASTERED");
  });

  it("keeps an MP3 voice in MP3", async () => {
    const calls: string[][] = [];
    const { writeFileSync } = await import("node:fs");
    await masterVoiceover(Buffer.from("ID3\u0004audio"), async (args) => {
      calls.push(args);
      writeFileSync(args[args.length - 1] ?? "", "MASTERED");
      return { stderr: calls.length === 1 ? LOUDNORM_LOG : "" };
    });

    expect(calls[1]?.join(" ")).toContain("libmp3lame");
    expect(calls[1]?.join(" ")).toContain("192k");
  });
});
