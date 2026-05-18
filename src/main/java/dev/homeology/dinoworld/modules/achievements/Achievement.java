package dev.homeology.dinoworld.modules.achievements;

/**
 * One achievement entry from the YAML catalog.
 *
 * @param id           stable identifier persisted in
 *                     {@code achievement_progress.achievement_id}; must
 *                     be unique within a catalog
 * @param displayName  shown in {@code /achievements} and the DM
 * @param description  one-line hint for the player
 * @param title        cosmetic equippable label granted on unlock
 *                     (also unique within a catalog)
 * @param trigger      predicate that decides "is this unlocked?"
 * @param rewardCoins  coins added on unlock (≥ 0)
 * @param rewardXp     XP added on unlock (≥ 0)
 */
public record Achievement(
	String id,
	String displayName,
	String description,
	String title,
	AchievementTrigger trigger,
	long rewardCoins,
	long rewardXp
) {
	public Achievement {
		if (id == null || id.isBlank()) {
			throw new IllegalArgumentException("achievement id required");
		}
		if (displayName == null || displayName.isBlank()) {
			throw new IllegalArgumentException("achievement display_name required for " + id);
		}
		if (title == null || title.isBlank()) {
			throw new IllegalArgumentException("achievement title required for " + id);
		}
		if (trigger == null) {
			throw new IllegalArgumentException("achievement trigger required for " + id);
		}
		if (rewardCoins < 0) {
			throw new IllegalArgumentException("achievement reward_coins < 0 for " + id);
		}
		if (rewardXp < 0) {
			throw new IllegalArgumentException("achievement reward_xp < 0 for " + id);
		}
	}
}
