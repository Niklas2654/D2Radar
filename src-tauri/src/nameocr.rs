//! Reading guardian names Windows' text recognition can't: names in other
//! scripts or of look-alike characters ("★尺E卂卩E尺★" for REAPER). Its
//! language packs (Japanese, Chinese) are on few PCs, so Radar brings its
//! own: PaddleOCR's PP-OCRv5 text line recognition (Chinese, Japanese and
//! English in one model; Apache-2.0, as ONNX from the RapidOCR project),
//! run with tract (pure Rust, no runtime to install).
//!
//! It reads one line of text (no finding it on screen: the name's place is
//! known from the "Season" line under it). A second model of the same kind
//! reads Cyrillic ("мармеладка", which the engine reads "MapMenaA1<a").

use std::io::Cursor;
use std::sync::LazyLock;

use image::RgbaImage;
use tract_onnx::prelude::*;

const MODEL: &[u8] = include_bytes!("../data/ocr/name_rec.onnx");
/// The characters it knows, one per line (its outputs 1..; 0 is "none",
/// the last a space).
const CHARS: &str = include_str!("../data/ocr/name_dict.txt");
/// The Cyrillic one (with Latin letters and digits too).
const CYRILLIC_MODEL: &[u8] = include_bytes!("../data/ocr/cyrillic_rec.onnx");
const CYRILLIC_CHARS: &str = include_str!("../data/ocr/cyrillic_dict.txt");

/// The model's input: a line of text scaled to this height, padded to this
/// width (one fixed shape: optimized once).
const HEIGHT: usize = 48;
const WIDTH: usize = 640;

type Plan = TypedRunnableModel<TypedModel>;

static READER: LazyLock<Option<(Plan, Vec<String>)>> = LazyLock::new(|| load(MODEL, CHARS));
static CYRILLIC: LazyLock<Option<(Plan, Vec<String>)>> = LazyLock::new(|| load(CYRILLIC_MODEL, CYRILLIC_CHARS));

/// A model ready to run, and its characters.
fn load(model: &[u8], chars: &str) -> Option<(Plan, Vec<String>)> {
    // Its variable sizes are named "DynamicDimension.0", a name tract can't
    // parse: "_" for the ".", the same length (the file stays valid).
    let mut model = model.to_vec();
    const NAME: &[u8] = b"DynamicDimension.";
    let mut i = 0;
    while let Some(at) = model[i..].windows(NAME.len()).position(|w| w == NAME) {
        let dot = i + at + NAME.len() - 1;
        model[dot] = b'_';
        i = dot + 1;
    }
    // The sizes it notes for the values between its layers are formulas
    // tract can't parse either ("floor(DynamicDimension_1/2 - 1/2) + 1"):
    // left out, tract works them out itself.
    let onnx = tract_onnx::onnx();
    let plan = onnx
        .proto_model_for_read(&mut Cursor::new(model))
        .and_then(|mut proto| {
            if let Some(graph) = proto.graph.as_mut() {
                graph.value_info.clear();
            }
            onnx.model_for_proto_model(&proto)
        })
        .and_then(|m| m.with_input_fact(0, f32::fact([1, 3, HEIGHT, WIDTH]).into()))
        .and_then(|m| m.into_optimized())
        .and_then(|m| m.into_runnable());
    match plan {
        Ok(plan) => {
            let mut chars: Vec<String> = chars.lines().map(|l| l.trim_end_matches('\r').to_string()).collect();
            chars.push(" ".into());
            Some((plan, chars))
        }
        Err(e) => {
            eprintln!("[nameocr] model: {e:?}");
            None
        }
    }
}

/// Whether the model knows `c` (one it doesn't is read as a look-alike it
/// knows: 卂 as A).
pub fn knows(c: char) -> bool {
    static KNOWN: LazyLock<std::collections::HashSet<char>> =
        LazyLock::new(|| CHARS.lines().filter_map(|l| l.trim_end_matches('\r').chars().next()).collect());
    KNOWN.contains(&c)
}

/// Load the models ahead (a second or so), so the first name reads at once.
pub fn warm_up() {
    std::thread::spawn(|| {
        LazyLock::force(&READER);
        LazyLock::force(&CYRILLIC);
    });
}

/// `line` read by each model: its text and how sure the model is of it
/// (the mean of its characters' probabilities, 0..1), the surest first.
pub fn read_line_all(line: &RgbaImage) -> Vec<(String, f32)> {
    // Each model on its own thread, at the same time (they don't share
    // anything): as long as the slower one, not both.
    let mut all: Vec<(String, f32)> = std::thread::scope(|s| {
        let reads: Vec<_> = [&READER, &CYRILLIC].into_iter().map(|m| s.spawn(move || read_with(m.as_ref()?, line))).collect();
        reads.into_iter().filter_map(|r| r.join().ok().flatten()).collect()
    });
    all.sort_by(|a, b| b.1.total_cmp(&a.1));
    all
}

/// The text of `line` (an image of one line of text) by the main model, and
/// how sure it is of it.
#[cfg(test)]
pub fn read_line(line: &RgbaImage) -> Option<(String, f32)> {
    read_with(READER.as_ref()?, line)
}

fn read_with((plan, chars): &(Plan, Vec<String>), line: &RgbaImage) -> Option<(String, f32)> {
    if line.width() == 0 || line.height() == 0 {
        return None;
    }
    let width = ((HEIGHT as f32 * line.width() as f32 / line.height() as f32).ceil() as usize).clamp(8, WIDTH);
    let scaled = image::imageops::resize(line, width as u32, HEIGHT as u32, image::imageops::FilterType::Triangle);
    // Channels as the model was trained (BGR), scaled to -1..1; the padding
    // right of the text 0 (as in training).
    let input = tract_ndarray::Array4::<f32>::from_shape_fn((1, 3, HEIGHT, WIDTH), |(_, c, y, x)| {
        if x >= width {
            return 0.0;
        }
        let p = scaled.get_pixel(x as u32, y as u32);
        (p[2 - c] as f32 / 255.0 - 0.5) / 0.5
    });
    let out = plan.run(tvec!(Tensor::from(input).into())).ok()?;
    let probs = out[0].to_array_view::<f32>().ok()?;
    let shape = probs.shape().to_vec();
    if shape.len() != 3 {
        return None;
    }
    // Per step the likeliest character; repeats and "none" dropped (CTC).
    let mut text = String::new();
    let mut sure = Vec::new();
    let mut last = 0usize;
    for t in 0..shape[1] {
        let (best, p) = (0..shape[2])
            .map(|k| (k, probs[[0, t, k]]))
            .fold((0, f32::MIN), |a, b| if b.1 > a.1 { b } else { a });
        if best != 0 && best != last {
            if let Some(c) = chars.get(best - 1) {
                text.push_str(c);
                sure.push(p);
            }
        }
        last = best;
    }
    let text = text.trim().to_string();
    if text.is_empty() {
        return None;
    }
    Some((text, sure.iter().sum::<f32>() / sure.len() as f32))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reads the name in $RADAR_NAME_SHOT, cropped to $RADAR_NAME_BOX
    /// ("x,y,w,h" in pixels).
    #[test]
    #[ignore]
    fn reads_name_from_shot() {
        let path = std::env::var("RADAR_NAME_SHOT").expect("RADAR_NAME_SHOT");
        let b: Vec<u32> = std::env::var("RADAR_NAME_BOX")
            .expect("RADAR_NAME_BOX")
            .split(',')
            .map(|n| n.trim().parse().unwrap())
            .collect();
        let full = image::open(path).unwrap().to_rgba8();
        let crop = image::imageops::crop_imm(&full, b[0], b[1], b[2], b[3]).to_image();
        let started = std::time::Instant::now();
        LazyLock::force(&READER);
        println!("loaded in {} ms", started.elapsed().as_millis());
        let started = std::time::Instant::now();
        let read = read_line(&crop);
        println!("read {:?} in {} ms", read, started.elapsed().as_millis());
    }

    /// One after the other against both at once, on $RADAR_NAME_SHOT cut to
    /// $RADAR_NAME_BOX (warm, a few runs each).
    #[test]
    #[ignore]
    fn both_models_timing() {
        let path = std::env::var("RADAR_NAME_SHOT").expect("RADAR_NAME_SHOT");
        let b: Vec<u32> = std::env::var("RADAR_NAME_BOX").expect("RADAR_NAME_BOX").split(',').map(|n| n.trim().parse().unwrap()).collect();
        let full = image::open(path).unwrap().to_rgba8();
        let crop = image::imageops::crop_imm(&full, b[0], b[1], b[2], b[3]).to_image();
        LazyLock::force(&READER);
        LazyLock::force(&CYRILLIC);
        read_line_all(&crop);
        let runs = 5;
        for (label, model) in [("main", &READER), ("cyrillic", &CYRILLIC)] {
            let started = std::time::Instant::now();
            for _ in 0..runs {
                read_with(model.as_ref().unwrap(), &crop);
            }
            println!("{label}: {} ms", started.elapsed().as_millis() / runs);
        }
        let started = std::time::Instant::now();
        for _ in 0..runs {
            read_line_all(&crop);
        }
        println!("both at once: {} ms", started.elapsed().as_millis() / runs);
    }
}
