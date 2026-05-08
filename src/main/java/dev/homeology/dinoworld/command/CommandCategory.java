package dev.homeology.dinoworld.command;

/**
 * Grouping bucket used by {@code /help} to organize the displayed command list.
 *
 * <p>Order of declaration is the order shown in the help embed. Each command
 * declares its bucket via {@link Command#category()}; the default is
 * {@link #GENERAL}, so existing commands need no change unless they belong
 * elsewhere.
 *
 * <p>Categories are independent of modules — a single module may contribute
 * commands to several categories (e.g. a future game module might expose
 * both {@link #GAME} commands and a {@link #UTILITY} admin command).
 */
public enum CommandCategory {

	/**
	 * Public, broadly-useful commands (e.g. {@code /help}, {@code /ping}, {@code /about}).
	 */
	GENERAL("General"),

	/**
	 * Zoo Tycoon game commands (the park dashboard, shop, eggs, hatch,
	 * feed, move, sell, enclosures, daily). Listed under "Tycoon" in
	 * {@code /help}.
	 */
	TYCOON("Tycoon"),

	/**
	 * Admin / moderation utilities for guild operators.
	 */
	UTILITY("Utility"),

	/**
	 * Developer-only diagnostics (e.g. {@code /debug}). Hidden from non-developers in {@code /help}.
	 */
	DEVELOPER("Developer");

	private final String displayName;

	CommandCategory(String displayName) {
		this.displayName = displayName;
	}

	/**
	 * @return the heading text shown for this category in the help embed
	 */
	public String displayName() {
		return displayName;
	}
}
