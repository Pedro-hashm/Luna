import { OmniRouteChoice, OmniRouteUsage } from "./types";

export interface OmniRouteResponse {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: OmniRouteChoice[];
    usage?: OmniRouteUsage;
}