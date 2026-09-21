import { Body, Controller, Get, Patch } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import type { SettingsResponse, UpdateSettingsRequest } from "./settings.types";

@Controller("settings")
export class SettingsController {
    constructor(private readonly settingsService: SettingsService) {}

    @Get()
    getSettings(): Promise<SettingsResponse> {
        return this.settingsService.getSettings();
    }

    @Patch()
    updateSettings(
        @Body() input: UpdateSettingsRequest,
    ): Promise<SettingsResponse> {
        return this.settingsService.updateSettings(input);
    }
}
