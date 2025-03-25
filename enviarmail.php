<?php
// Habilitar exibição de erros
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

// Inclua os arquivos necessários do PHPMailer
require 'PHPMailer/PHPMailer.php';
require 'PHPMailer/SMTP.php';
require 'PHPMailer/Exception.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

$mail = new PHPMailer(true);

try {
    // Configurações do servidor SMTP
    $mail->isSMTP();
    $mail->Host = 'smtp.office365.com'; // Servidor SMTP do Outlook/Hotmail
    $mail->SMTPAuth = true;
    $mail->Username = 'andre_taruma1993@hotmail.com'; // Seu e-mail
    $mail->Password = 'Favo@1234'; // Sua senha
    $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
    $mail->Port = 587;

    // Ativar a depuração do SMTP
    $mail->SMTPDebug = 2; // Nível de depuração: 2 para mensagens detalhadas

    // Remetente e destinatário
    $mail->setFrom('andre_taruma1993@hotmail.com', 'André Taruma');
    $mail->addAddress('andretarumajundiai@gmail.com', 'André Taruma Jundiaí');

    // Conteúdo do e-mail
    $mail->isHTML(true);
    $mail->Subject = 'Assunto do E-mail';

    // Corpo do e-mail em HTML
    $mail->Body    = '
    <html>
    <head>
        <style>
            body {
                font-family: Arial, sans-serif;
            }
            .container {
                width: 80%;
                margin: 0 auto;
                padding: 20px;
                border: 1px solid #ddd;
                border-radius: 5px;
            }
            .header {
                background-color: #f4f4f4;
                padding: 10px;
                text-align: center;
                border-bottom: 1px solid #ddd;
            }
            .content {
                padding: 20px;
            }
            .footer {
                background-color: #f4f4f4;
                padding: 10px;
                text-align: center;
                border-top: 1px solid #ddd;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Bem-vindo ao nosso serviço!</h1>
            </div>
            <div class="content">
                <p>Olá,</p>
                <p>Obrigado por se inscrever em nosso serviço. Estamos empolgados em tê-lo conosco.</p>
                <p>Se você tiver alguma dúvida, não hesite em entrar em contato conosco.</p>
                <p>Atenciosamente,<br>Equipe de Suporte</p>
            </div>
            <div class="footer">
                <p>&copy; ' . date('Y') . ' Nossa Empresa. Todos os direitos reservados.</p>
            </div>
        </div>
    </body>
    </html>';
    
     



    // Enviar e-mail
    $mail->send();
    echo 'E-mail enviado com sucesso!';
} catch (Exception $e) {
    echo "O e-mail não pôde ser enviado. Erro: {$mail->ErrorInfo}";
}
?>
