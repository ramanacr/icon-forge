use iconforge_outline_wasm::{outline_json, outline_stroke, Point, Segment, StrokeSpec, Subpath};

fn horizontal() -> Subpath {
    Subpath {
        start: Point(2.0, 4.0),
        segments: vec![Segment::L {
            to: Point(22.0, 4.0),
        }],
        closed: false,
    }
}

fn bounds(paths: &[Vec<Point>]) -> (f64, f64, f64, f64) {
    let points: Vec<_> = paths.iter().flatten().collect();
    (
        points.iter().map(|p| p.0).fold(f64::INFINITY, f64::min),
        points.iter().map(|p| p.1).fold(f64::INFINITY, f64::min),
        points.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max),
        points.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max),
    )
}

#[test]
fn butt_cap_has_exact_line_extent() {
    let result =
        outline_stroke(&[horizontal()], StrokeSpec::new(4.0, "butt", "miter", 4.0)).unwrap();
    assert_eq!(bounds(&result), (2.0, 2.0, 22.0, 6.0));
}

#[test]
fn round_cap_extends_by_half_width() {
    let result =
        outline_stroke(&[horizontal()], StrokeSpec::new(4.0, "round", "round", 4.0)).unwrap();
    let (min_x, min_y, max_x, max_y) = bounds(&result);
    assert!((min_x - 0.0).abs() < 0.02);
    assert!((max_x - 24.0).abs() < 0.02);
    assert_eq!((min_y, max_y), (2.0, 6.0));
}

#[test]
fn duplicate_strokes_union_to_one_contour() {
    let result = outline_stroke(
        &[horizontal(), horizontal()],
        StrokeSpec::new(4.0, "butt", "bevel", 4.0),
    )
    .unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(bounds(&result), (2.0, 2.0, 22.0, 6.0));
}

#[test]
fn invalid_stroke_is_rejected() {
    assert!(outline_stroke(&[horizontal()], StrokeSpec::new(0.0, "butt", "miter", 4.0)).is_err());
    assert!(outline_stroke(
        &[horizontal()],
        StrokeSpec::new(4.0, "unknown", "miter", 4.0)
    )
    .is_err());
}

#[test]
fn json_entrypoint_returns_contours() {
    let request = r#"{"paths":[{"start":[2,4],"segments":[{"k":"L","to":[22,4]}],"closed":false}],"stroke":{"width":4,"cap":"butt","join":"miter","miter_limit":4}}"#;
    let output: serde_json::Value = serde_json::from_str(&outline_json(request)).unwrap();
    assert_eq!(output["path"].as_array().unwrap().len(), 1);
    assert!(output.get("error").is_none());
}

#[test]
fn dashed_stroke_reports_font_diagnostic() {
    let request = r#"{"paths":[{"start":[2,4],"segments":[{"k":"L","to":[22,4]}],"closed":false}],"stroke":{"width":4,"cap":"butt","join":"miter","miter_limit":4,"dash":[2,2]}}"#;
    let output: serde_json::Value = serde_json::from_str(&outline_json(request)).unwrap();
    assert_eq!(output["error"], "font.dash-unsupported");
}

#[test]
fn quadratic_and_cubic_segments_are_stroked() {
    let quadratic = Subpath {
        start: Point(2.0, 2.0),
        segments: vec![
            Segment::Q {
                c: Point(12.0, 16.0),
                to: Point(22.0, 2.0),
            },
            Segment::C {
                c1: Point(22.0, 4.0),
                c2: Point(4.0, 4.0),
                to: Point(2.0, 2.0),
            },
        ],
        closed: true,
    };
    let result = outline_stroke(&[quadratic], StrokeSpec::new(2.0, "round", "round", 4.0)).unwrap();
    assert!(!result.is_empty());
    assert!(bounds(&result).2 > 22.0);
}

#[test]
fn all_cap_and_join_pairs_produce_finite_closed_outlines() {
    let corner = Subpath {
        start: Point(2.0, 20.0),
        segments: vec![
            Segment::L {
                to: Point(12.0, 2.0),
            },
            Segment::L {
                to: Point(22.0, 20.0),
            },
        ],
        closed: false,
    };
    for cap in ["butt", "round", "square"] {
        for join in ["miter", "round", "bevel"] {
            let output =
                outline_stroke(&[corner.clone()], StrokeSpec::new(2.0, cap, join, 4.0)).unwrap();
            assert!(!output.is_empty(), "{cap}/{join}");
            assert!(output
                .iter()
                .flatten()
                .all(|point| point.0.is_finite() && point.1.is_finite()));
        }
    }
}

#[test]
fn zero_length_round_stroke_produces_a_dot() {
    let dot = Subpath {
        start: Point(12.0, 12.0),
        segments: vec![Segment::L {
            to: Point(12.0, 12.0),
        }],
        closed: false,
    };
    let output = outline_stroke(&[dot], StrokeSpec::new(4.0, "round", "round", 4.0)).unwrap();
    let (x0, y0, x1, y1) = bounds(&output);
    assert!(x0 <= 10.01 && y0 <= 10.01 && x1 >= 13.99 && y1 >= 13.99);
}

#[test]
fn closed_stroke_retains_a_hole_with_opposite_winding() {
    let square = Subpath {
        start: Point(2.0, 2.0),
        segments: vec![
            Segment::L {
                to: Point(22.0, 2.0),
            },
            Segment::L {
                to: Point(22.0, 22.0),
            },
            Segment::L {
                to: Point(2.0, 22.0),
            },
        ],
        closed: true,
    };
    let output = outline_stroke(&[square], StrokeSpec::new(4.0, "butt", "miter", 4.0)).unwrap();
    assert_eq!(output.len(), 2);
    let area = |contour: &Vec<Point>| -> f64 {
        contour
            .iter()
            .zip(contour.iter().cycle().skip(1))
            .take(contour.len())
            .map(|(a, b)| a.0 * b.1 - a.1 * b.0)
            .sum::<f64>()
            / 2.0
    };
    assert!(area(&output[0]) * area(&output[1]) < 0.0);
}

#[test]
fn filled_contour_unions_with_overlapping_stroke() {
    let request = r#"{"paths":[{"start":[2,4],"segments":[{"k":"L","to":[22,4]}],"closed":false}],"stroke":{"width":4,"cap":"butt","join":"miter","miter_limit":4},"fills":[{"start":[8,4],"segments":[{"k":"L","to":[16,4]},{"k":"L","to":[16,12]},{"k":"L","to":[8,12]}],"closed":true}]}"#;
    let output: serde_json::Value = serde_json::from_str(&outline_json(request)).unwrap();
    assert_eq!(output["path"].as_array().unwrap().len(), 1);
    let points = output["path"][0].as_array().unwrap();
    assert!(points.iter().any(|point| point[1] == 12.0));
}

#[test]
fn miter_limit_switches_to_bevel_at_an_acute_corner() {
    let corner = Subpath {
        start: Point(3.0, 20.0),
        segments: vec![
            Segment::L {
                to: Point(12.0, 3.0),
            },
            Segment::L {
                to: Point(21.0, 20.0),
            },
        ],
        closed: false,
    };
    let miter = outline_stroke(
        &[corner.clone()],
        StrokeSpec::new(4.0, "butt", "miter", 4.0),
    )
    .unwrap();
    let bevel = outline_stroke(&[corner], StrokeSpec::new(4.0, "butt", "miter", 1.0)).unwrap();
    assert!(bounds(&miter).1 < bounds(&bevel).1);
}

#[test]
fn cusp_reversal_and_tiny_segment_have_finite_output() {
    let cusp = Subpath {
        start: Point(2.0, 12.0),
        segments: vec![
            Segment::L {
                to: Point(22.0, 12.0),
            },
            Segment::L {
                to: Point(2.0, 12.0),
            },
            Segment::L {
                to: Point(2.00001, 12.0),
            },
        ],
        closed: false,
    };
    let output = outline_stroke(&[cusp], StrokeSpec::new(2.0, "round", "round", 4.0)).unwrap();
    assert!(!output.is_empty());
    assert!(output
        .iter()
        .flatten()
        .all(|p| p.0.is_finite() && p.1.is_finite()));
}

#[test]
fn large_coordinates_keep_small_stroke_dimensions() {
    let path = Subpath {
        start: Point(1_000_000_002.0, 1_000_000_004.0),
        segments: vec![Segment::L {
            to: Point(1_000_000_022.0, 1_000_000_004.0),
        }],
        closed: false,
    };
    let output = outline_stroke(&[path], StrokeSpec::new(4.0, "butt", "miter", 4.0)).unwrap();
    assert_eq!(
        bounds(&output),
        (
            1_000_000_002.0,
            1_000_000_002.0,
            1_000_000_022.0,
            1_000_000_006.0
        )
    );
}

#[test]
fn degenerate_contour_is_dropped_with_info() {
    let request = r#"{"paths":[{"start":[0,0],"segments":[{"k":"L","to":[0.01,0]}],"closed":false}],"stroke":{"width":0.01,"cap":"butt","join":"miter","miter_limit":4}}"#;
    let output: serde_json::Value = serde_json::from_str(&outline_json(request)).unwrap();
    assert_eq!(output["path"].as_array().unwrap().len(), 0);
    assert_eq!(output["diagnostics"][0]["severity"], "info");
}

#[test]
fn evenodd_fills_normalize_nested_hole_winding() {
    let request = r#"{"paths":[],"stroke":{"width":2,"cap":"butt","join":"miter","miter_limit":4},"fills":[{"start":[2,2],"segments":[{"k":"L","to":[22,2]},{"k":"L","to":[22,22]},{"k":"L","to":[2,22]}],"closed":true},{"start":[8,8],"segments":[{"k":"L","to":[16,8]},{"k":"L","to":[16,16]},{"k":"L","to":[8,16]}],"closed":true}],"fill_rule":"evenodd"}"#;
    let output: serde_json::Value = serde_json::from_str(&outline_json(request)).unwrap();
    let contours = output["path"].as_array().unwrap();
    assert_eq!(contours.len(), 2);
    let area = |contour: &serde_json::Value| -> f64 {
        let points = contour.as_array().unwrap();
        points
            .iter()
            .zip(points.iter().cycle().skip(1))
            .take(points.len())
            .map(|(a, b)| {
                a[0].as_f64().unwrap() * b[1].as_f64().unwrap()
                    - a[1].as_f64().unwrap() * b[0].as_f64().unwrap()
            })
            .sum::<f64>()
            / 2.0
    };
    assert!(area(&contours[0]) * area(&contours[1]) < 0.0);
}
