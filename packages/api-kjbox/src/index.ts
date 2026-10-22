// Only the contract's types and the app-facing facades are public; the generated SDK function names
// (getNight, searchSongs, ...) deliberately stay internal so they cannot collide with the facades.
// Explicit allowlist: `export type *` would also export the generated `Error`, shadowing the global.
export type {
  ErrorCode, Night, NightClosed, NightOpen, NoticeDef, Social, Contact, Features, Me, JoinRequest, NightChangedError, AdditionalSinger, SongRequest, RequestResult, SubmitRequest, ChangeSongRequest, ReorderItem, ReorderRequest, SongConsentRequest, CancelRequest, RenameGuardError, SongItemRequest, Estimate, Song, MeProfile, NextTurn, MeResult, UpdateMeRequest, UpdateMeResult, OkResult, SearchSong, SearchResult, IdentifiedSong, IdentifyResult, ArtistTitle, ResolveResult, SearchEventRequest, SingersResult, NowEntry, NowResult, RotationEntry, RotationResult, PreviewRequest, PreviewResult, PreviewCloseRequest, TipMethod, TipsResult, TipClaimRequest, TipClaimResult, TopSong, MyStatsResult, SearchVersion, MakeSongRequest, MakeCheckRequest, MakeCheckResult, MakeAudioResult, MakeSearchResult, MakeUrlRequest, MakeUrlResult, UseQuickRequest, PushTokenRequest, EventCode, NightId, GetNightError, JoinNightError, CreateRequestError, CancelRequestError, ChangeRequestError, ReorderRequestsError, SetRequestConsentError, GetMeError, UpdateMeError, SearchSongsError, IdentifySongError, ResolveSearchError, LogSearchEventError, ListSingersError, GetNowError, GetRotationError, ResolvePreviewError, ClosePreviewError, GetTipsError, ClaimTipError, GetMyStatsError, CheckMakeError, MakeSearchError, ValidateMakeUrlError, UseQuickVersionError, RegisterPushTokenError,
  Error as KjboxErrorBody,
} from './client/types.gen';
export { configureClient, configureClient as configureKjbox, MAKE_TIMEOUT_MS, type ClientDeps } from './configure';
export { KjboxError, type KjboxErrorCode } from './errors';
export * from './facades';
