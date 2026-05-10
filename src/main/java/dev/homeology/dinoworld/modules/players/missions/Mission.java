package dev.homeology.dinoworld.modules.players.missions;

/**
 * One mission entry from a {@link MissionCatalog} YAML file.
 *
 * @param id            stable identifier persisted in
 *                      {@code mission_progress.mission_id}; must be
 *                      unique within a set
 * @param displayName   shown in the {@code /missions} list and on the
 *                      auto-award follow-up
 * @param description   one-line hint for the player
 * @param trigger       what makes this mission satisfied
 * @param rewardCoins   coins added on completion (≥ 0)
 * @param rewardXp      XP added on completion (≥ 0)
 */
public record Mission(
	String id,
	String displayName,
	String description,
	MissionTrigger trigger,
	long rewardCoins,
	long rewardXp
) {
	public Mission {
		if (id == null || id.isBlank()) throw new IllegalArgumentException("mission id required");
		if (displayName == null || displayName.isBlank()) {
			throw new IllegalArgumentException("mission display_name required for " + id);
		}
		if (trigger == null) throw new IllegalArgumentException("mission trigger required for " + id);
		if (rewardCoins < 0) throw new IllegalArgumentException("mission reward_coins < 0 for " + id);
		if (rewardXp < 0) throw new IllegalArgumentException("mission reward_xp < 0 for " + id);
	}
}
