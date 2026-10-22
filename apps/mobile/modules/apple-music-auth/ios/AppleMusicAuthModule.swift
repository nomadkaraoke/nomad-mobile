import ExpoModulesCore
import MusicKit

/// Native Apple Music sign-in for decide: ask for Apple Music access, then turn decide's developer token into
/// a Music User Token (the same token MusicKit JS returns on the web), without leaving the app.
public class AppleMusicAuthModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleMusicAuth")

    /// Resolves `{ status, token?, code? }`; status is authorized, denied, restricted, notDetermined or error.
    AsyncFunction("requestUserToken") { (developerToken: String) async -> [String: String] in
      let status = await MusicAuthorization.request()
      switch status {
      case .authorized:
        break
      case .denied:
        return ["status": "denied"]
      case .restricted:
        return ["status": "restricted"]
      default:
        return ["status": "notDetermined"]
      }
      do {
        let token = try await DefaultMusicTokenProvider().userToken(for: developerToken, options: [])
        return ["status": "authorized", "token": token]
      } catch let error as MusicTokenRequestError {
        return ["status": "error", "code": Self.code(error)]
      } catch {
        return ["status": "error", "code": "unknown"]
      }
    }
  }

  private static func code(_ error: MusicTokenRequestError) -> String {
    switch error {
    case .permissionDenied: return "permissionDenied"
    case .privacyAcknowledgementRequired: return "privacyAcknowledgementRequired"
    case .userNotSignedIn: return "userNotSignedIn"
    case .userTokenRequestFailed: return "userTokenRequestFailed"
    case .developerTokenRequestFailed: return "developerTokenRequestFailed"
    default: return "unknown"
    }
  }
}
