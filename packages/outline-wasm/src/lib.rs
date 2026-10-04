use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::float::overlay::FloatOverlay;
use serde::{Deserialize, Serialize};
use tiny_skia_path::{LineCap, LineJoin, Path, PathBuilder, PathSegment, Stroke};
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct Point(pub f64, pub f64);

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Subpath {
    pub start: Point,
    pub segments: Vec<Segment>,
    pub closed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "k")]
pub enum Segment {
    L { to: Point },
    Q { c: Point, to: Point },
    C { c1: Point, c2: Point, to: Point },
}

impl Segment {
    fn points(&self) -> Vec<Point> {
        match self {
            Self::L { to } => vec![*to],
            Self::Q { c, to } => vec![*c, *to],
            Self::C { c1, c2, to } => vec![*c1, *c2, *to],
        }
    }
}

impl Subpath {
    fn to_path(&self, close: bool) -> Result<Option<Path>, &'static str> {
        if !self.start.0.is_finite()
            || !self.start.1.is_finite()
            || self.segments.iter().flat_map(Segment::points).any(|p| {
                !p.0.is_finite()
                    || !p.1.is_finite()
                    || !(p.0 - self.start.0).is_finite()
                    || !(p.1 - self.start.1).is_finite()
                    || (p.0 - self.start.0).abs() > f32::MAX as f64
                    || (p.1 - self.start.1).abs() > f32::MAX as f64
            })
        {
            return Err("outline.invalid-path");
        }
        let local = |p: Point| ((p.0 - self.start.0) as f32, (p.1 - self.start.1) as f32);
        let mut builder = PathBuilder::new();
        builder.move_to(0.0, 0.0);
        for segment in &self.segments {
            match segment {
                Segment::L { to } => {
                    let (x, y) = local(*to);
                    builder.line_to(x, y)
                }
                Segment::Q { c, to } => {
                    let (cx, cy) = local(*c);
                    let (x, y) = local(*to);
                    builder.quad_to(cx, cy, x, y)
                }
                Segment::C { c1, c2, to } => {
                    let (x1, y1) = local(*c1);
                    let (x2, y2) = local(*c2);
                    let (x, y) = local(*to);
                    builder.cubic_to(x1, y1, x2, y2, x, y)
                }
            };
        }
        if close {
            builder.close();
        }
        Ok(builder.finish())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StrokeSpec {
    pub width: f64,
    pub cap: String,
    pub join: String,
    pub miter_limit: f64,
    #[serde(default)]
    pub dash: Vec<f64>,
}

impl StrokeSpec {
    pub fn new(width: f64, cap: &str, join: &str, miter_limit: f64) -> Self {
        Self {
            width,
            cap: cap.into(),
            join: join.into(),
            miter_limit,
            dash: Vec::new(),
        }
    }

    fn to_skia(&self) -> Result<Stroke, &'static str> {
        if !self.width.is_finite()
            || self.width <= 0.0
            || self.width > f32::MAX as f64
            || !self.miter_limit.is_finite()
            || self.miter_limit <= 0.0
        {
            return Err("outline.invalid-stroke");
        }
        let line_cap = match self.cap.as_str() {
            "butt" => LineCap::Butt,
            "round" => LineCap::Round,
            "square" => LineCap::Square,
            _ => return Err("outline.invalid-stroke"),
        };
        let line_join = match self.join.as_str() {
            "miter" => LineJoin::Miter,
            "round" => LineJoin::Round,
            "bevel" => LineJoin::Bevel,
            _ => return Err("outline.invalid-stroke"),
        };
        Ok(Stroke {
            width: self.width as f32,
            miter_limit: self.miter_limit as f32,
            line_cap,
            line_join,
            ..Stroke::default()
        })
    }
}

fn sample_quadratic(a: Point, b: Point, c: Point, t: f64) -> Point {
    let s = 1.0 - t;
    Point(
        s * s * a.0 + 2.0 * s * t * b.0 + t * t * c.0,
        s * s * a.1 + 2.0 * s * t * b.1 + t * t * c.1,
    )
}

fn sample_cubic(a: Point, b: Point, c: Point, d: Point, t: f64) -> Point {
    let s = 1.0 - t;
    Point(
        s * s * s * a.0 + 3.0 * s * s * t * b.0 + 3.0 * s * t * t * c.0 + t * t * t * d.0,
        s * s * s * a.1 + 3.0 * s * s * t * b.1 + 3.0 * s * t * t * c.1 + t * t * t * d.1,
    )
}

fn flatten(path: &tiny_skia_path::Path, origin: Point) -> Vec<Vec<[f64; 2]>> {
    let mut contours = Vec::new();
    let mut contour = Vec::new();
    let mut current = Point(0.0, 0.0);
    for segment in path.segments() {
        match segment {
            PathSegment::MoveTo(p) => {
                if contour.len() >= 3 {
                    contours.push(contour);
                }
                contour = vec![[origin.0 + p.x as f64, origin.1 + p.y as f64]];
                current = Point(p.x as f64, p.y as f64);
            }
            PathSegment::LineTo(p) => {
                current = Point(p.x as f64, p.y as f64);
                contour.push([origin.0 + current.0, origin.1 + current.1]);
            }
            PathSegment::QuadTo(c, p) => {
                let start = current;
                let control = Point(c.x as f64, c.y as f64);
                let end = Point(p.x as f64, p.y as f64);
                for step in 1..=16 {
                    let point = sample_quadratic(start, control, end, step as f64 / 16.0);
                    contour.push([origin.0 + point.0, origin.1 + point.1]);
                }
                current = end;
            }
            PathSegment::CubicTo(c1, c2, p) => {
                let start = current;
                let first = Point(c1.x as f64, c1.y as f64);
                let second = Point(c2.x as f64, c2.y as f64);
                let end = Point(p.x as f64, p.y as f64);
                for step in 1..=16 {
                    let point = sample_cubic(start, first, second, end, step as f64 / 16.0);
                    contour.push([origin.0 + point.0, origin.1 + point.1]);
                }
                current = end;
            }
            PathSegment::Close => {
                if contour.len() >= 3 {
                    contours.push(std::mem::take(&mut contour));
                }
            }
        }
    }
    contours
}

/// Expand line subpaths to filled, unioned contours with normalized winding.
pub fn outline_stroke(
    paths: &[Subpath],
    style: StrokeSpec,
) -> Result<Vec<Vec<Point>>, &'static str> {
    if !style.dash.is_empty() {
        return Err("font.dash-unsupported");
    }
    let stroke = style.to_skia()?;
    let mut result: Vec<Vec<[f64; 2]>> = Vec::new();
    for path in paths {
        let Some(source) = path.to_path(path.closed)? else {
            continue;
        };
        let Some(stroked) = source.stroke(&stroke, 1.0) else {
            continue;
        };
        let contours = flatten(&stroked, path.start);
        let mut overlay = FloatOverlay::<[f64; 2], i64>::from_subj_and_clip(&result, &contours);
        result = overlay
            .overlay(OverlayRule::Union, FillRule::NonZero)
            .into_iter()
            .flatten()
            .collect();
    }
    Ok(result
        .into_iter()
        .map(|contour| contour.into_iter().map(|p| Point(p[0], p[1])).collect())
        .collect())
}

#[derive(Deserialize)]
struct OutlineRequest {
    paths: Vec<Subpath>,
    stroke: StrokeSpec,
    #[serde(default)]
    fills: Vec<Subpath>,
    fill_rule: Option<String>,
}

fn outline_icon(input: OutlineRequest) -> Result<Vec<Vec<Point>>, &'static str> {
    let stroked = outline_stroke(&input.paths, input.stroke)?;
    if input.fills.is_empty() {
        return Ok(stroked);
    }
    let rule = match input.fill_rule.as_deref().unwrap_or("nonzero") {
        "nonzero" => FillRule::NonZero,
        "evenodd" => FillRule::EvenOdd,
        _ => return Err("outline.invalid-fill-rule"),
    };
    let mut filled = Vec::new();
    for path in input.fills {
        if !path.closed {
            return Err("outline.invalid-fill");
        }
        if let Some(source) = path.to_path(true)? {
            filled.extend(flatten(&source, path.start));
        }
    }
    let empty: Vec<Vec<[f64; 2]>> = Vec::new();
    let mut fill_overlay = FloatOverlay::<[f64; 2], i64>::from_subj_and_clip(&filled, &empty);
    let fill_shapes: Vec<Vec<[f64; 2]>> = fill_overlay
        .overlay(OverlayRule::Union, rule)
        .into_iter()
        .flatten()
        .collect();
    let stroke_contours: Vec<Vec<[f64; 2]>> = stroked
        .into_iter()
        .map(|contour| contour.into_iter().map(|p| [p.0, p.1]).collect())
        .collect();
    let mut overlay =
        FloatOverlay::<[f64; 2], i64>::from_subj_and_clip(&stroke_contours, &fill_shapes);
    Ok(overlay
        .overlay(OverlayRule::Union, FillRule::NonZero)
        .into_iter()
        .flatten()
        .map(|contour| contour.into_iter().map(|p| Point(p[0], p[1])).collect())
        .collect())
}

fn contour_area(contour: &[Point]) -> f64 {
    let Some(origin) = contour.first() else {
        return 0.0;
    };
    contour
        .iter()
        .zip(contour.iter().cycle().skip(1))
        .take(contour.len())
        .map(|(a, b)| (a.0 - origin.0) * (b.1 - origin.1) - (a.1 - origin.1) * (b.0 - origin.0))
        .sum::<f64>()
        / 2.0
}

#[wasm_bindgen]
pub fn outline_json(request: &str) -> String {
    let parsed: Result<OutlineRequest, _> = serde_json::from_str(request);
    let result = match parsed {
        Ok(input) => match outline_icon(input) {
            Ok(mut path) => {
                let before = path.len();
                path.retain(|contour| contour_area(contour).abs() >= 0.001);
                if path.len() < before {
                    serde_json::json!({ "path": path, "diagnostics": [
                        { "code": "font.degenerate-contour", "severity": "info" }
                    ] })
                } else {
                    serde_json::json!({ "path": path, "diagnostics": [] })
                }
            }
            Err(error) => serde_json::json!({ "error": error }),
        },
        Err(_) => serde_json::json!({ "error": "outline.invalid-input" }),
    };
    result.to_string()
}
