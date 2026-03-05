pub fn exponential_decay(base: f32, lambda: f32, age_seconds: f32) -> f32 {
    let factor = (-lambda * age_seconds).exp();
    base * factor
}
