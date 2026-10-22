Pod::Spec.new do |s|
  s.name           = 'AppleMusicAuth'
  s.version        = '1.0.0'
  s.summary        = 'Native Apple Music (MusicKit) sign-in: permission + Music User Token'
  s.description    = 'Asks for Apple Music access and returns a Music User Token for decide.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
