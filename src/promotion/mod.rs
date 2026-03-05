use crate::decay::exponential_decay;

#[derive(Debug, Clone, Copy)]
pub struct PromotionSignal {
    pub in_degree: usize,
    pub access_frequency: f32,
    pub highlight_weight_sum: f32,
    pub cross_branch_presence: f32,
    pub age_seconds: f32,
    pub decay_lambda: f32,
}

pub fn compute_importance(signal: PromotionSignal) -> f32 {
    let base = ((signal.in_degree as f32) + 1.0).ln()
        + signal.access_frequency
        + signal.highlight_weight_sum
        + signal.cross_branch_presence;

    exponential_decay(base.max(0.0), signal.decay_lambda, signal.age_seconds).max(0.0)
}
