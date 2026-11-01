import PhotosUI
import UIKit
import UniformTypeIdentifiers
import WebKit

final class ViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, UIDocumentPickerDelegate, PHPickerViewControllerDelegate {
    private let baseURL: URL = {
        let raw = Bundle.main.object(forInfoDictionaryKey: "HAONLINEBaseURL") as? String
        return URL(string: raw ?? "") ?? URL(string: "https://haonline.example.com")!
    }()

    private var webView: WKWebView!
    private let spinner = UIActivityIndicatorView(style: .large)
    private let errorView = UIView()
    private let errorLabel = UILabel()
    private var fileCompletion: (([URL]?) -> Void)?
    private var configured = false

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.024, green: 0.031, blue: 0.078, alpha: 1)

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.applicationNameForUserAgent = "HAONLINEiOS/1.0"

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsLinkPreview = true
        webView.backgroundColor = view.backgroundColor
        webView.isOpaque = false
        webView.scrollView.backgroundColor = view.backgroundColor
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.color = .white
        spinner.hidesWhenStopped = true
        view.addSubview(spinner)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])

        buildErrorView()
        loadHome()
    }

    private func buildErrorView() {
        errorView.translatesAutoresizingMaskIntoConstraints = false
        errorView.backgroundColor = view.backgroundColor
        errorView.isHidden = true

        let mark = UILabel()
        mark.text = "H"
        mark.textAlignment = .center
        mark.font = .systemFont(ofSize: 40, weight: .heavy)
        mark.textColor = UIColor(red: 0.024, green: 0.031, blue: 0.078, alpha: 1)
        mark.backgroundColor = UIColor(red: 0.545, green: 0.486, blue: 1.0, alpha: 1)
        mark.layer.cornerRadius = 18
        mark.clipsToBounds = true
        mark.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            mark.widthAnchor.constraint(equalToConstant: 68),
            mark.heightAnchor.constraint(equalToConstant: 68),
        ])

        errorLabel.text = "Không thể kết nối HAONLINE. Kiểm tra mạng và thử lại."
        errorLabel.textColor = UIColor(red: 0.66, green: 0.69, blue: 0.82, alpha: 1)
        errorLabel.textAlignment = .center
        errorLabel.numberOfLines = 0
        errorLabel.font = .systemFont(ofSize: 16)

        let retry = UIButton(type: .system)
        retry.setTitle("Thử lại", for: .normal)
        retry.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        retry.backgroundColor = UIColor(red: 0.545, green: 0.486, blue: 1.0, alpha: 1)
        retry.tintColor = UIColor(red: 0.024, green: 0.031, blue: 0.078, alpha: 1)
        retry.layer.cornerRadius = 12
        retry.translatesAutoresizingMaskIntoConstraints = false
        retry.heightAnchor.constraint(equalToConstant: 48).isActive = true
        retry.addTarget(self, action: #selector(retryLoad), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [mark, errorLabel, retry])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        errorView.addSubview(stack)
        view.addSubview(errorView)

        NSLayoutConstraint.activate([
            errorView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            errorView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            errorView.topAnchor.constraint(equalTo: view.topAnchor),
            errorView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.centerYAnchor.constraint(equalTo: errorView.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: errorView.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: errorView.trailingAnchor, constant: -32),
            retry.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
    }

    private func loadHome() {
        errorView.isHidden = true
        spinner.startAnimating()
        webView.load(URLRequest(url: baseURL, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
    }

    @objc private func retryLoad() {
        loadHome()
    }

    private func isTrusted(_ url: URL) -> Bool {
        let scheme = url.scheme?.lowercased() ?? ""
        if ["about", "blob", "data"].contains(scheme) { return true }
        guard ["http", "https"].contains(scheme) else { return false }
        return url.host?.caseInsensitiveCompare(baseURL.host ?? "") == .orderedSame
    }

    private func openExternal(_ url: URL) {
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    private func finishFiles(_ urls: [URL]?) {
        let completion = fileCompletion
        fileCompletion = nil
        completion?(urls)
    }

    private func topPresenter() -> UIViewController? {
        var controller: UIViewController? = self
        while let presented = controller?.presentedViewController {
            controller = presented
        }
        return controller
    }

    private func presentAlert(title: String?, message: String, completion: @escaping (Bool, String?) -> Void) {
        guard let presenter = topPresenter() else {
            completion(false, nil)
            return
        }
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completion(true, nil) })
        alert.addAction(UIAlertAction(title: "Hủy", style: .cancel) { _ in completion(false, nil) })
        presenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if navigationAction.targetFrame == nil {
            if isTrusted(url) {
                webView.load(navigationAction.request)
            } else {
                openExternal(url)
            }
            decisionHandler(.cancel)
            return
        }
        if isTrusted(url) {
            decisionHandler(.allow)
        } else {
            openExternal(url)
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.canShowMIMEType {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        errorView.isHidden = true
        spinner.startAnimating()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        spinner.stopAnimating()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleLoadError(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleLoadError(error)
    }

    private func handleLoadError(_ error: Error) {
        spinner.stopAnimating()
        let code = (error as NSError).code
        if code == NSURLErrorCancelled { return }
        errorView.isHidden = false
        view.bringSubviewToFront(errorView)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard let presenter = topPresenter() else {
            completionHandler()
            return
        }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        presenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        presentAlert(title: nil, message: message) { confirmed, _ in
            completionHandler(confirmed)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        guard let presenter = topPresenter() else {
            completionHandler(nil)
            return
        }
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { field in field.text = defaultText }
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            completionHandler(alert.textFields?.first?.text)
        })
        alert.addAction(UIAlertAction(title: "Hủy", style: .cancel) { _ in completionHandler(nil) })
        presenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if isTrusted(url) {
                webView.load(navigationAction.request)
            } else {
                openExternal(url)
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let trusted = origin.host.caseInsensitiveCompare(baseURL.host ?? "") == .orderedSame
        decisionHandler(trusted ? .grant : .deny)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        if fileCompletion != nil { finishFiles(nil) }
        fileCompletion = completionHandler

        let sheet = UIAlertController(title: "Chọn tệp", message: nil, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "Thư viện ảnh", style: .default) { [weak self] _ in
            self?.presentPhotoPicker(allowsMultiple: parameters.allowsMultipleSelection)
        })
        sheet.addAction(UIAlertAction(title: "Tệp", style: .default) { [weak self] _ in
            self?.presentDocumentPicker(allowsMultiple: parameters.allowsMultipleSelection)
        })
        sheet.addAction(UIAlertAction(title: "Hủy", style: .cancel) { [weak self] _ in
            self?.finishFiles(nil)
        })

        guard let presenter = topPresenter() else {
            finishFiles(nil)
            return
        }
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        presenter.present(sheet, animated: true)
    }

    private func presentDocumentPicker(allowsMultiple: Bool) {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        picker.allowsMultipleSelection = allowsMultiple
        picker.delegate = self
        topPresenter()?.present(picker, animated: true)
    }

    private func presentPhotoPicker(allowsMultiple: Bool) {
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.filter = .any(of: [.images, .videos])
        config.selectionLimit = allowsMultiple ? 0 : 1
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        topPresenter()?.present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finishFiles(urls.isEmpty ? nil : urls)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finishFiles(nil)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard !results.isEmpty else {
            finishFiles(nil)
            return
        }

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("haonline-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let group = DispatchGroup()
        let lock = NSLock()
        var urls: [URL] = []

        for result in results {
            let provider = result.itemProvider
            let type = provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier)
                ? UTType.movie.identifier
                : UTType.image.identifier
            group.enter()
            provider.loadFileRepresentation(forTypeIdentifier: type) { source, _ in
                defer { group.leave() }
                guard let source else { return }
                let ext = source.pathExtension.isEmpty ? "jpg" : source.pathExtension
                let target = directory.appendingPathComponent("\(UUID().uuidString).\(ext)")
                do {
                    try FileManager.default.copyItem(at: source, to: target)
                    lock.lock()
                    urls.append(target)
                    lock.unlock()
                } catch {
                    return
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            self?.finishFiles(urls.isEmpty ? nil : urls)
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !configured {
            configured = true
            setNeedsStatusBarAppearanceUpdate()
        }
    }
}
